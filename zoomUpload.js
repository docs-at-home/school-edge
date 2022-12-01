// zoomUpload.js
//
exports.handler = async (event, context) => {
  try {
    const phScript = new ZoomUpload({ event, context });
    return await phScript.main();
  } catch (e) {
    throw e;
  }
};

const AWS = require('aws-sdk');
const _ = require('lodash');
const { inspect } = require('util');

class ZoomUpload {
  constructor(props = {}) {
    this._event = props.event;
    this._data = JSON.parse(this._event.body||'{}');
  }

  async main() {
    // TODO Verify Zoom `authorization` header as per https://marketplace.zoom.us/docs/api-reference/webhook-reference#headers
    if (this._data.event !== 'recording.completed') {
      console.warn(`Received Zoom event ${this._data.event}. Ignoring.`);
      return;
    }
    const code = this.getCourseCode();
    if (!code) {
      console.warn(`Could not find course code in meeting "${this._data.payload.object.topic}". Ignoring.`);
      return;
    }
    const videos = this.getVideoFiles();
    if (!videos.length) {
      console.warn(`Could not find any eligible video in meeting "${this._data.payload.object.topic}". Ignoring.`);
      return;
    }

    const fn = `labyrinth-service-${process.env['STAGE']}-zoomUploadAsync`;
    for (const video of videos) {
      try {
        await this.invokeLambda(fn, video, code);
      }
      catch (error) {
        console.error(`Error occurred while invoking upload function ${fn} for meeting "${this._data.payload.object.topic}": ${error}`);
      }
    }
  }

  async invokeLambda(fn, video, code) {
    return new Promise((resolve, reject) => {
      const lambda = new AWS.Lambda({ region: process.env['REGION'] });
      lambda.invoke({ FunctionName: fn, InvocationType: 'Event', Payload: JSON.stringify({
        topic: this._data.payload.object.topic,
        code,
        video
      })}, (error, result) => {
        if (error) {
          reject(error);
        }
        else {
          resolve(result);
        }
      });
    });
  }

  // Detect if this is a course meeting having a [code123] substring.
  getCourseCode() {
    const code = _.get(this._data, 'payload.object.topic', '').match(/\[(\w+)\]/);
    return code && code[1];
  }

  // Detect video files that we want to upload.
  getVideoFiles() {
    return _.get(this._data, 'payload.object.recording_files', []).filter(file => {
      const start = new Date(file.recording_start);
      const end = new Date(file.recording_end);
      // Return mp4 videos with running time >= 2min
      return file.file_type.toUpperCase() === "MP4"
          && end - start >= 1000*60*2
    });
  }
}

// zoomUploadAsync.js
//
ports.handler = async (event, context) => {
  try {
    const phScript = new ZoomUploadAsync({ event, context });
    return await phScript.main();
  } catch (e) {
    throw e;
  }
};

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const AWS = require('aws-sdk');
const _ = require('lodash');
const { inspect } = require('util');

// https://stackoverflow.com/a/10075654/209184
function padDigits(number, digits) {
    return Array(Math.max(digits - String(number).length + 1, 0)).join(0) + number;
}

const PREFIX = 'courses/uploads';

class ZoomUploadAsync {
  constructor(props = {}) {
    this._event = props.event;
  }

  async main() {
    const video = this._event.video;
    try {
      await this.uploadZoomToS3(
        video.download_url,
        video.file_size,
        this.recordingTofilename(),
        `${PREFIX}/${this._event.code}`
      );
    }
    catch (error) {
      console.error(`Error occurred while uploading video at ${video.play_url} for meeting "${this._event.topic}": ${error}`);
    }
  }

  async uploadZoomToS3(zoomDownloadUrl, size, fileName, prefix) {
    const zoomToken = this.generateZoomToken();
    return new Promise((resolve, reject) => {
      fetch(`${zoomDownloadUrl}?access_token=${zoomToken}`, {
        method: 'GET',
        redirect: 'follow'
      })
      .then(response => {
        const s3 = new AWS.S3();
        const request = s3.putObject({
          Bucket: process.env['DESTINATION_BUCKET'],
          Key: `${prefix}/${fileName}`,
          Body: response.body,
          ContentType: 'video/mp4',
          ContentLength: size || Number(response.headers.get('content-length'))
        });
        return request.promise();
      })
      .then(data => {
        console.log(`Successfully uploaded ${fileName} to ${prefix}.`);
        resolve(data);
      });
    });
  }

  generateZoomToken() {
    const zoomPayload = {
      iss: process.env['ZOOM_API_KEY'],
      exp: ((new Date()).getTime() + 5000)
    };
    return jwt.sign(zoomPayload, process.env['ZOOM_API_SECRET']);
  }

  recordingTofilename() {
    // GMT20210429_165119_Recording.mp4
    const video = this._event.video;
    const date = new Date(video.recording_start);
    return 'GMT' +
           date.getUTCFullYear() +
           padDigits(date.getUTCMonth()+1, 2) +
           padDigits(date.getUTCDate(), 2) +
           '_' +
           padDigits(date.getUTCHours(), 2) +
           padDigits(date.getUTCMinutes(), 2) +
           padDigits(date.getUTCSeconds(), 2) +
           '_Recording.mp4';
  }
}

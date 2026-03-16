import * as faceapi from 'face-api.js';

const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

export async function loadModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
  ]);
}

export async function getFaceDescriptor(imageElement: HTMLImageElement | HTMLVideoElement) {
  // Use TinyFaceDetector for faster processing
  const detection = await faceapi
    .detectSingleFace(imageElement, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  
  return detection?.descriptor;
}

export async function warmUpModels() {
  // Create a tiny dummy canvas to warm up the models
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
}

export function createFaceMatcher(students: any[]) {
  const labeledDescriptors = students.map(s => {
    const descriptor = new Float32Array(JSON.parse(s.face_descriptor));
    return new faceapi.LabeledFaceDescriptors(s.student_id, [descriptor]);
  });

  return new faceapi.FaceMatcher(labeledDescriptors, 0.6);
}

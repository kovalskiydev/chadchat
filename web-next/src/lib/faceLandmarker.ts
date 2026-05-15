const VISION_TASKS_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_LANDMARKER_MODEL_URL =
  "https://chadchat.ams1.vultrobjects.com/face/face_landmarker.task";

export type FaceLandmark = { x: number; y: number; z?: number };

export type FaceLandmarkerResult = {
  faceLandmarks?: Array<Array<FaceLandmark>>;
  facialTransformationMatrixes?: Array<{ data?: number[] } | number[]>;
};

export type ChadFaceLandmarker = {
  detectForVideo: (video: HTMLVideoElement, now: number) => FaceLandmarkerResult;
  close?: () => void;
};

type VisionTasksModule = {
  FilesetResolver: {
    forVisionTasks: (basePath: string) => Promise<unknown>;
  };
  FaceLandmarker: {
    createFromOptions: (
      fileset: unknown,
      options: Record<string, unknown>,
    ) => Promise<ChadFaceLandmarker>;
  };
};

export type FaceEngineStatus = "idle" | "loading" | "ready" | "failed";

let faceLandmarkerPromise: Promise<ChadFaceLandmarker> | null = null;
let faceEngineStatus: FaceEngineStatus = "idle";
let faceEngineError: Error | null = null;

async function createFaceLandmarker() {
  faceEngineStatus = "loading";
  faceEngineError = null;
  try {
    const importFromUrl = new Function("url", "return import(url)") as (
      url: string,
    ) => Promise<unknown>;
    const vision = (await importFromUrl(VISION_TASKS_URL)) as VisionTasksModule;
    const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM_URL);
    const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: FACE_LANDMARKER_MODEL_URL,
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceEngineStatus = "ready";
    return landmarker;
  } catch (error) {
    faceEngineStatus = "failed";
    faceEngineError = error instanceof Error ? error : new Error("Face engine failed to load");
    faceLandmarkerPromise = null;
    throw faceEngineError;
  }
}

export function preloadFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = createFaceLandmarker();
  }
  return faceLandmarkerPromise;
}

export function getFaceLandmarker() {
  return preloadFaceLandmarker();
}

export function retryFaceLandmarker() {
  faceLandmarkerPromise = null;
  faceEngineStatus = "idle";
  faceEngineError = null;
  return preloadFaceLandmarker();
}

export function getFaceEngineStatus() {
  return {
    status: faceEngineStatus,
    error: faceEngineError,
  };
}

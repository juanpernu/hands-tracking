import { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandData } from '../types';

const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

interface UseHandTrackingReturn {
  hands: HandData[];
  isReady: boolean;
  error: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useHandTracking(): UseHandTrackingReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number>(-1);

  const [hands, setHands] = useState<HandData[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // RAF detection loop — defined before the setup effect so the ref is stable.
  const detectLoop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !landmarker || video.readyState < 2) {
      rafIdRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    const timestamp = performance.now();

    // MediaPipe requires strictly increasing timestamps.
    if (timestamp <= lastTimestampRef.current) {
      rafIdRef.current = requestAnimationFrame(detectLoop);
      return;
    }
    lastTimestampRef.current = timestamp;

    const results = landmarker.detectForVideo(video, timestamp);

    if (results.landmarks.length > 0) {
      const detected: HandData[] = results.landmarks.map((landmarkGroup, index) => {
        // Use MediaPipe's handedness directly — the coordinate mirroring
        // in normalizedToPixel already handles the front-camera flip.
        const handedness: HandData['handedness'] =
          (results.handedness[index]?.[0]?.categoryName as 'Left' | 'Right') ?? 'Right';

        return {
          handedness,
          landmarks: landmarkGroup.map((lm) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
          })),
        };
      });

      setHands(detected);
    } else {
      setHands([]);
    }

    rafIdRef.current = requestAnimationFrame(detectLoop);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      // 1. Request camera access.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Camera access denied: ${err.message}`
              : 'Camera access denied.'
          );
        }
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      // Attach stream to the video element and wait for it to be playable.
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Video element failed to load stream.'));
        video.play().catch(reject);
      });

      if (cancelled) return;

      // 2. Initialise MediaPipe HandLandmarker via CDN WASM.
      let landmarker: HandLandmarker;
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_ASSET_PATH,
            delegate: 'GPU',
          },
          numHands: 2,
          runningMode: 'VIDEO',
          minHandDetectionConfidence: 0.7,
          minHandPresenceConfidence: 0.7,
          minTrackingConfidence: 0.5,
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `MediaPipe init failed: ${err.message}`
              : 'MediaPipe initialisation failed.'
          );
        }
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      if (cancelled) {
        landmarker.close();
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      landmarkerRef.current = landmarker;
      setIsReady(true);

      // 3. Start the RAF detection loop.
      rafIdRef.current = requestAnimationFrame(detectLoop);
    }

    initialize().catch((err) => {
      if (!cancelled) {
        setError(
          err instanceof Error ? err.message : 'Unknown initialisation error.'
        );
      }
    });

    return () => {
      cancelled = true;

      // Cancel the animation frame first so the loop stops calling detectForVideo.
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      // Release GPU/WASM resources.
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }

      // Release camera hardware.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      // Clear the video src so the browser releases the MediaStream reference.
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setIsReady(false);
    };
  }, [detectLoop]);

  return { hands, isReady, error, videoRef };
}

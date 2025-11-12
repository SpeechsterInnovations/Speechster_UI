#!/usr/bin/env python3
import sys, torch, torchaudio, numpy as np, json, time
from torchvision import models

SAMPLE_RATE = 16000
FRAME_MS = 250
FRAME_SIZE = SAMPLE_RATE * FRAME_MS // 1000
ROLLING_BUFFER_SEC = 1.0
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

CLASSES = [
    "forward", "four", "go", "happy", "hello", "house", "learn", "left", "marvin",
    "nine", "no", "off", "on", "one", "right", "seven", "sheila", "six", "stop",
    "three", "tree", "two", "up", "visual", "wow", "yes", "zero"
]
NUM_CLASSES = len(CLASSES)

DETECTION_THRESHOLD = 0.8
STABILITY_FRAMES = 3
COOLDOWN_SEC = 1.5

model = models.resnet18(weights=None)
model.fc = torch.nn.Linear(model.fc.in_features, NUM_CLASSES)
model.to(DEVICE)

# --- Safe checkpoint load ---
ckpt = torch.load("cnn_model.pth", map_location=DEVICE)
if "state_dict" in ckpt:
    ckpt = ckpt["state_dict"]

# Detect fc layer shape mismatch and drop if incompatible
def _shape(k): return tuple(ckpt[k].shape) if k in ckpt else None
if "fc.weight" in ckpt and _shape("fc.weight") != tuple(model.fc.weight.shape):
    print(f"[WARN] Adjusting fc layer: ckpt {_shape('fc.weight')} vs model {tuple(model.fc.weight.shape)}")
    ckpt.pop("fc.weight", None)
    ckpt.pop("fc.bias", None)

missing, unexpected = model.load_state_dict(ckpt, strict=False)
if missing or unexpected:
    print(f"[INFO] Missing keys: {missing}, Unexpected: {unexpected}")

print(f"[OK] Model loaded ({NUM_CLASSES} classes) on {DEVICE}")
model.eval()

mel_transform = torchaudio.transforms.MelSpectrogram(
    sample_rate=SAMPLE_RATE, n_fft=1024, hop_length=512, n_mels=128
)

buffer = np.zeros(int(ROLLING_BUFFER_SEC * SAMPLE_RATE), dtype=np.float32)
conf_history = []
last_infer_time = 0
last_detected = None
last_trigger_time = 0

def classify(buf):
    waveform = torch.tensor(buf).unsqueeze(0)
    mel = mel_transform(waveform)
    mel = torch.log(mel + 1e-9)
    mel = (mel - mel.min()) / (mel.max() - mel.min())
    mel = torch.cat([mel]*3, dim=0).unsqueeze(0).to(DEVICE)
    mel = torch.nn.functional.interpolate(mel, size=(128,128))
    with torch.no_grad():
        out = model(mel)
        probs = torch.nn.functional.softmax(out, dim=1)[0]
    return probs.cpu().numpy()

chunk_bytes = b""
BYTES_PER_SAMPLE = 2

try:
    while True:
        data = sys.stdin.buffer.read(4096)
        if not data:
            time.sleep(0.001)
            continue
        chunk_bytes += data
        while len(chunk_bytes) >= FRAME_SIZE * BYTES_PER_SAMPLE:
            frame = np.frombuffer(chunk_bytes[:FRAME_SIZE*BYTES_PER_SAMPLE], dtype=np.int16)
            chunk_bytes = chunk_bytes[FRAME_SIZE*BYTES_PER_SAMPLE:]
            chunk = frame.astype(np.float32) / 32768.0
            buffer = np.concatenate([buffer[len(chunk):], chunk])

            now = time.time()
            if now - last_infer_time < FRAME_MS / 1000.0:
                continue
            last_infer_time = now

            probs = classify(buffer)
            label_idx = int(np.argmax(probs))
            conf = float(probs[label_idx])
            label = CLASSES[label_idx]
            conf_history.append((label, conf))
            if len(conf_history) > STABILITY_FRAMES:
                conf_history.pop(0)

            labels = [x[0] for x in conf_history]
            if labels.count(label) == len(conf_history):
                avg_conf = np.mean([x[1] for x in conf_history])
            else:
                avg_conf = 0

            if (
                avg_conf >= DETECTION_THRESHOLD
                and (last_detected != label or time.time() - last_trigger_time > COOLDOWN_SEC)
            ):
                last_detected = label
                last_trigger_time = time.time()
                result = {"label": label, "confidence": round(avg_conf, 3), "timestamp": time.time()}
                print(json.dumps(result), flush=True)

except KeyboardInterrupt:
    pass


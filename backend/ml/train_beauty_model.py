import argparse
import json
from pathlib import Path

import joblib
import numpy as np
from PIL import Image
from sklearn.decomposition import PCA
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def load_dataset(dataset_dir: Path, img_size: int):
    labels_path = dataset_dir / "labels.txt"
    images_dir = dataset_dir / "Images" / "Images"

    if not labels_path.exists():
        raise FileNotFoundError(f"labels.txt not found in {dataset_dir}")
    if not images_dir.exists():
        raise FileNotFoundError(f"image directory not found: {images_dir}")

    rows = []
    for line in labels_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        name, score = line.split()
        rows.append((name, float(score)))

    X = []
    y = []

    for name, score in rows:
        img_path = images_dir / name
        if not img_path.exists():
            continue
        img = Image.open(img_path).convert("L").resize((img_size, img_size), Image.Resampling.BILINEAR)
        arr = np.asarray(img, dtype=np.float32) / 255.0
        X.append(arr.reshape(-1))
        y.append(score)

    if not X:
        raise RuntimeError("No samples were loaded")

    return np.asarray(X, dtype=np.float32), np.asarray(y, dtype=np.float32)


def load_hf_dataset(dataset_id: str, split: str, img_size: int):
    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise RuntimeError("Please install `datasets`: python3 -m pip install datasets") from exc

    ds = load_dataset(dataset_id, split=split)
    X = []
    y = []
    for row in ds:
        img = row.get("image")
        rating = row.get("rating")
        if img is None or rating is None:
            continue
        if isinstance(img, np.ndarray):
            pil = Image.fromarray(img)
        else:
            pil = img
        pil = pil.convert("L").resize((img_size, img_size), Image.Resampling.BILINEAR)
        arr = np.asarray(pil, dtype=np.float32) / 255.0
        X.append(arr.reshape(-1))
        y.append(float(rating))

    if not X:
        raise RuntimeError(f"No samples were loaded from HF dataset: {dataset_id} / {split}")
    return np.asarray(X, dtype=np.float32), np.asarray(y, dtype=np.float32)


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train baseline beauty regressor on SCUT-FBP5500")
    parser.add_argument("--dataset-dir", required=True, help="Path to Kaggle dataset root (with labels.txt)")
    parser.add_argument("--hf-dataset", default="", help="Optional HF dataset id, e.g. tranhuy/facial-beauty-rating")
    parser.add_argument("--hf-split", default="train", help="HF split name")
    parser.add_argument("--hf-weight", type=float, default=1.0, help="Sample weight for HF rows in training")
    parser.add_argument("--img-size", type=int, default=64, help="Resize side for grayscale images")
    parser.add_argument("--alpha", type=float, default=4.0, help="Ridge alpha")
    parser.add_argument("--pca-components", type=int, default=256, help="PCA components before Ridge")
    parser.add_argument("--test-size", type=float, default=0.2, help="Test split")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--out-dir", default="ml/artifacts", help="Output directory")
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    X_sc, y_sc = load_dataset(dataset_dir, args.img_size)
    X = X_sc
    y = y_sc
    source = np.array(["scut"] * len(X_sc))
    if args.hf_dataset:
      X_hf, y_hf = load_hf_dataset(args.hf_dataset, args.hf_split, args.img_size)
      X = np.concatenate([X_sc, X_hf], axis=0)
      y = np.concatenate([y_sc, y_hf], axis=0)
      source = np.concatenate([source, np.array(["hf"] * len(X_hf))], axis=0)

    idx = np.arange(len(X))
    train_idx, test_idx = train_test_split(idx, test_size=args.test_size, random_state=args.seed, shuffle=True)
    X_train, X_test = X[train_idx], X[test_idx]
    y_train, y_test = y[train_idx], y[test_idx]
    src_train, src_test = source[train_idx], source[test_idx]

    model = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("pca", PCA(n_components=args.pca_components, svd_solver="randomized", random_state=args.seed)),
            ("ridge", Ridge(alpha=args.alpha, random_state=args.seed)),
        ]
    )

    train_weights = np.ones(len(X_train), dtype=np.float32)
    if args.hf_dataset and args.hf_weight != 1.0:
        train_weights[src_train == "hf"] = args.hf_weight

    model.fit(X_train, y_train, ridge__sample_weight=train_weights)

    train_pred = model.predict(X_train)
    test_pred = model.predict(X_test)

    metrics = {
        "samples_total": int(len(X)),
        "samples_train": int(len(X_train)),
        "samples_test": int(len(X_test)),
        "samples_scut": int((source == "scut").sum()),
        "samples_hf": int((source == "hf").sum()),
        "img_size": args.img_size,
        "alpha": args.alpha,
        "pca_components": args.pca_components,
        "hf_dataset": args.hf_dataset,
        "hf_split": args.hf_split,
        "hf_weight": args.hf_weight,
        "train_mae": float(mean_absolute_error(y_train, train_pred)),
        "train_rmse": rmse(y_train, train_pred),
        "train_r2": float(r2_score(y_train, train_pred)),
        "test_mae": float(mean_absolute_error(y_test, test_pred)),
        "test_rmse": rmse(y_test, test_pred),
        "test_r2": float(r2_score(y_test, test_pred)),
        "test_mae_scut": float(mean_absolute_error(y_test[src_test == "scut"], test_pred[src_test == "scut"])) if np.any(src_test == "scut") else None,
        "test_mae_hf": float(mean_absolute_error(y_test[src_test == "hf"], test_pred[src_test == "hf"])) if np.any(src_test == "hf") else None,
    }

    model_path = out_dir / "beauty_model_ridge.joblib"
    metrics_path = out_dir / "beauty_model_metrics.json"

    joblib.dump(model, model_path)
    metrics_path.write_text(json.dumps(metrics, indent=2))

    print(f"Model saved: {model_path}")
    print(f"Metrics saved: {metrics_path}")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

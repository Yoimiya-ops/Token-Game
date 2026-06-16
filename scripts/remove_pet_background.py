#!/usr/bin/env python3
import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter


def build_initial_mask(image_rgb: np.ndarray) -> np.ndarray:
    height, width = image_rgb.shape[:2]
    mask = np.full((height, width), cv2.GC_PR_BGD, dtype=np.uint8)

    border = max(2, int(min(width, height) * 0.08))
    mask[:border, :] = cv2.GC_BGD
    mask[-border:, :] = cv2.GC_BGD
    mask[:, :border] = cv2.GC_BGD
    mask[:, -border:] = cv2.GC_BGD

    rect_margin_x = max(1, int(width * 0.05))
    rect_margin_y = max(1, int(height * 0.05))
    mask[rect_margin_y : height - rect_margin_y, rect_margin_x : width - rect_margin_x] = cv2.GC_PR_FGD
    return mask


def remove_background(input_path: Path, output_path: Path) -> None:
    image = Image.open(input_path).convert('RGBA')
    rgba = np.array(image)
    rgb = rgba[:, :, :3]

    mask = build_initial_mask(rgb)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(rgb, mask, None, bgd_model, fgd_model, 8, cv2.GC_INIT_WITH_MASK)

    foreground = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    kernel = np.ones((3, 3), np.uint8)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, kernel, iterations=1)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel, iterations=1)

    alpha = Image.fromarray(foreground).filter(ImageFilter.GaussianBlur(radius=0.7))
    output = Image.fromarray(rgba)
    output.putalpha(alpha)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description='Remove desktop pet image background with GrabCut.')
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    remove_background(args.input, args.output)


if __name__ == '__main__':
    main()

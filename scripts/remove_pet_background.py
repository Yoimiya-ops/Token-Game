#!/usr/bin/env python3
import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageSequence


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


def has_meaningful_alpha(image: Image.Image) -> bool:
    alpha = image.getchannel('A')
    extrema = alpha.getextrema()
    if extrema[0] >= 250:
        return False

    transparent_pixels = sum(count for value, count in enumerate(alpha.histogram()) if value < 250)
    return transparent_pixels / (image.width * image.height) > 0.02


def cut_out_frame(image: Image.Image) -> Image.Image:
    if has_meaningful_alpha(image):
        return image.copy()

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
    return output


def smooth_generated_alpha(frames: list[Image.Image], generated: list[bool]) -> list[Image.Image]:
    if len(frames) < 3 or not all(generated):
        return frames

    smoothed: list[Image.Image] = []
    alpha_arrays = [np.array(frame.getchannel('A'), dtype=np.float32) for frame in frames]

    for index, frame in enumerate(frames):
        previous_alpha = alpha_arrays[index - 1]
        current_alpha = alpha_arrays[index]
        next_alpha = alpha_arrays[(index + 1) % len(frames)]
        alpha = ((previous_alpha + current_alpha * 2 + next_alpha) / 4).astype(np.uint8)
        output = frame.copy()
        output.putalpha(Image.fromarray(alpha))
        smoothed.append(output)

    return smoothed


def read_frames(input_path: Path) -> tuple[list[Image.Image], list[int]]:
    with Image.open(input_path) as image:
        fallback_duration = image.info.get('duration') or 100
        frames: list[Image.Image] = []
        durations: list[int] = []

        for frame in ImageSequence.Iterator(image):
            frames.append(frame.convert('RGBA').copy())
            durations.append(frame.info.get('duration') or fallback_duration)

    return frames, durations


def save_frames(frames: list[Image.Image], durations: list[int], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_path.suffix.lower() == '.webp' and len(frames) > 1:
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            lossless=True,
            method=6,
        )
        return

    frames[0].save(output_path)


def remove_background(input_path: Path, output_path: Path) -> None:
    frames, durations = read_frames(input_path)
    processed_frames: list[Image.Image] = []
    generated_alpha: list[bool] = []

    for frame in frames:
        already_transparent = has_meaningful_alpha(frame)
        processed_frames.append(cut_out_frame(frame))
        generated_alpha.append(not already_transparent)

    processed_frames = smooth_generated_alpha(processed_frames, generated_alpha)
    save_frames(processed_frames, durations, output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description='Remove desktop pet image background with GrabCut.')
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    remove_background(args.input, args.output)


if __name__ == '__main__':
    main()

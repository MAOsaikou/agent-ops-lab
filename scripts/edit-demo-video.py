"""Programmatic borderless video editing, Chinese AI voiceover, frosted-charcoal
floating pill captions, and stopwatch timelapse pipeline for AgentOps Harness.

Design aligned with modern product launch / explainer best practices:
- Zero artificial top/bottom letterbox bars: 1920x940 crisp 1:1 product UI
  (browser tabs & address bar cropped cleanly at y=88, 1px cream margin pad).
- Opens directly on the live main dashboard (no separate title card), pauses
  cleanly to introduce the platform, flows naturally through every core feature,
  accelerates the 2m30s live LLM benchmark wait with a frosted-charcoal dynamic
  stopwatch card, and ends gently on the saved-history dashboard.
- Warm-charcoal translucent pill subtitles rendered with Pillow (Microsoft YaHei
  Bold) floating 20px above the bottom edge only while speaking.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import cv2
import edge_tts
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SUBMISSION_DIR = ROOT / "赛题一+三分拙劲破天下+AgentOps Harness-可信多智能体编排与验证平台"
DEFAULT_INPUT = SUBMISSION_DIR / "屏幕录制 2026-11-20 005634.mp4"
DEFAULT_OUTPUT = SUBMISSION_DIR / "AgentOps-Harness-功能演示视频.mp4"
DEFAULT_BUILD_DIR = Path(
    os.environ.get(
        "AGENTOPS_VIDEO_BUILD_DIR",
        str(Path(tempfile.gettempdir()) / "agentops_demo_video_build"),
    )
)

FONT_BOLD_PATH = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_REG_PATH = r"C:\Windows\Fonts\msyh.ttc"

OUT_W = 1920
OUT_H = 940
FPS = 30
CROP_W = 1918
CROP_H = 940
CROP_X = 0
CROP_Y = 88  # Removes Edge tabs/address bar cleanly (88 + 940 = 1028)

VOICE = "zh-CN-XiaoxiaoNeural"
VOICE_RATE = "+8%"

# Palette harmonized with the warm-paper & charcoal product UI
PAPER_HEX = "#F3EBE0"
PAPER_RGB = (243, 235, 224)
CHARCOAL_PILL_RGBA = (26, 23, 20, 214)
CHARCOAL_CARD_RGBA = (24, 21, 18, 234)
CARD_BORDER_RGBA = (242, 198, 102, 175)
PILL_BORDER_RGBA = (255, 255, 255, 48)
GOLD_RGB = (242, 198, 102)
EMERALD_RGB = (56, 189, 140)
WHITE_RGB = (255, 255, 255)
MUTED_RGB = (212, 207, 198)


@dataclass(frozen=True)
class Segment:
    idx: int
    kind: Literal["start_hold", "clip", "timelapse", "end_clip"]
    src_start: float
    src_end: float
    narration: str
    allow_fast: bool = False


SEGMENTS: list[Segment] = [
    Segment(
        idx=1,
        kind="start_hold",
        src_start=0.0,
        src_end=6.6,
        narration="欢迎了解智能开店参谋平台。它就像一支分工明确的 AI 团队，帮电商卖家算清成本、防亏本、自动砍价。打开主界面，顶部三大功能一目了然：先算单件商品能不能上架，再模拟连续开店应对断供和价格战，最后拿多 AI 团队和单 AI 同台比拼。",
    ),
    Segment(
        idx=2,
        kind="clip",
        src_start=6.8,
        src_end=10.1,
        narration="点开右上角配置，可以看到系统已经接通真实的 DeepSeek 大模型。但和普通聊天 AI 不同，这里的每笔账都有严格校验，绝不乱编数字。",
    ),
    Segment(
        idx=3,
        kind="clip",
        src_start=11.5,
        src_end=26.0,
        narration="用起来非常顺手：贴入商品链接或手填进货价和运费就行，资料不全助手还会主动追问。这里选一件拼多多纯棉短袖，点击开始评审。",
    ),
    Segment(
        idx=4,
        kind="clip",
        src_start=31.5,
        src_end=44.5,
        narration="点击后，十个分工不同的 AI 立刻接力干活：有算成本的、看同行的、管推广的，还有专门挑刺的风控官，每一步进度和耗时全都透明可见。",
    ),
    Segment(
        idx=5,
        kind="clip",
        src_start=44.5,
        src_end=53.5,
        narration="算完后系统不会擅自做主，而是停下来等你拍板。保本底价二十七块四毛七，推荐稳价卖四十块九，同时也坦诚提醒本金偏紧有六天会缺货。点击拍板通过，锁定方案。",
    ),
    Segment(
        idx=6,
        kind="clip",
        src_start=53.5,
        src_end=65.5,
        narration="往下看，稳价、跟价、冲量三套方案并排对比，每单赚多少清清楚楚。下面是完整风险体检表，达标打绿勾、风险标红叉，拍板后自动盖上防伪编码封存。",
    ),
    Segment(
        idx=7,
        kind="clip",
        src_start=65.5,
        src_end=69.5,
        narration="更让人放心的是，只要大模型回答超标或不够严谨，系统会自动拦截并切换保底方案，绝不把糊涂账交到卖家手里。",
    ),
    Segment(
        idx=8,
        kind="clip",
        src_start=81.5,
        src_end=91.5,
        narration="展开下方底稿，采购、运费、退货损耗全都有据可查；系统还顺手写好了符合平台规矩的商品标题和卖点，自动避开违规极限词，一键就能复制上架。",
    ),
    Segment(
        idx=9,
        kind="clip",
        src_start=101.5,
        src_end=107.5,
        narration="再看第二个更有意思的案例：一款京东护颈枕，我们故意填了每天高达五百元的广告预算，看看 AI 团队会不会盲目烧冤枉钱。",
    ),
    Segment(
        idx=10,
        kind="clip",
        src_start=107.5,
        src_end=130.5,
        narration="画面中，十个 AI 正在协作评审这款护颈枕，风控官很快发现了广告费太烧钱的问题，立刻打回去自动降预算重算，连改两轮。",
        allow_fast=True,
    ),
    Segment(
        idx=11,
        kind="clip",
        src_start=130.5,
        src_end=149.0,
        narration="自动改完两轮后结果出炉：保本价三十块八毛二，推荐卖八十九块九，毛利率高达百分之五十一点六，最差行情下三十天也能保底赚四万多。点一下拍板通过。",
    ),
    Segment(
        idx=12,
        kind="clip",
        src_start=149.0,
        src_end=160.5,
        narration="往下看，彩色进度条拆解了进货、快递、广告各占多少，每单净赚四十六块多；右边画出未来三十天的现金流走势，以及十个 AI 分别干了多少次活。",
    ),
    Segment(
        idx=13,
        kind="clip",
        src_start=171.5,
        src_end=177.5,
        narration="看这张最直观的自动改错前后对比：系统把每天广告费从三百元压到一百八，立省一百二，毛利率从四十二点七直接飙升到五十一点六，缺货也少了一天！",
    ),
    Segment(
        idx=14,
        kind="clip",
        src_start=186.0,
        src_end=190.0,
        narration="算清单品后，点击右下角按钮，就能把这件商品一键带入八回合模拟开店沙盘，提前演练真实经营。",
    ),
    Segment(
        idx=15,
        kind="clip",
        src_start=190.0,
        src_end=203.0,
        narration="这里模拟一家网店连续经营八个回合，专门考验三大突发状况：春季大促、主力厂家突然断供，以及同行恶意打价格战。我们选中主供断供，一键开跑。",
    ),
    Segment(
        idx=16,
        kind="clip",
        src_start=203.0,
        src_end=211.5,
        narration="八个回合瞬间跑完，遭遇断供依然净赚六百四十一元。更聪明的是，第一回合复盘市场反馈后，定价助手自动把策略升级到了新版本，真正做到吃一堑长一智。",
    ),
    Segment(
        idx=17,
        kind="clip",
        src_start=211.5,
        src_end=216.0,
        narration="看这份谈判记录：第二、三回合主力厂家一没货，AI 立刻找备用厂家连砍三轮拿下货源，而且每句对白都严格把关，绝不说漏自己的心理底价。",
    ),
    Segment(
        idx=18,
        kind="clip",
        src_start=216.0,
        src_end=226.5,
        narration="往下是八个回合的资金和利润走势，最底部是防篡改电子账本。每回合结完账都会盖上环环相扣的防伪封条，点尝试修改会被直接拦截，保证账目真实可信。",
    ),
    Segment(
        idx=19,
        kind="clip",
        src_start=231.0,
        src_end=237.5,
        narration="接下来进入最关键的同台比武环节：到底是一群 AI 分工合作强，还是单个 AI 单干就行？我们点下按钮，拿同一套考卷同时考测四种模式。",
    ),
    Segment(
        idx=20,
        kind="clip",
        src_start=251.5,
        src_end=257.5,
        narration="参赛的四位选手分别是：死板公式、单个 AI 包办全部活、没有风控的多 AI，以及我们完整的分工加挑刺多 AI 团队。",
    ),
    Segment(
        idx=21,
        kind="timelapse",
        src_start=257.5,
        src_end=387.5,
        narration="注意这里为什么等了很久：后台正实时连接真实大模型，把十二道带坑选品题和三场八回合开店实战全部真枪实弹跑完，实际耗时约两分半钟。为节省时间，我们加速跳过等待，直接看真实成绩！",
        allow_fast=True,
    ),
    Segment(
        idx=22,
        kind="clip",
        src_start=391.5,
        src_end=407.0,
        narration="真实成绩出炉！先看十二道带坑选品题：死公式和单个 AI 单干都只做对七道，正确率不到六成；我们的多 AI 团队一下子提高到十道，超过八成三，而且零漏检，缺资料百分之百诚实追问，绝不瞎编。",
    ),
    Segment(
        idx=23,
        kind="clip",
        src_start=408.5,
        src_end=412.0,
        narration="再看最硬核的连续开店总账单：死公式直接亏了八百八十九元；单个 AI 赚一千三百五十四元；我们的完整多 AI 团队狂赚一千七百九十三元拿下总冠军，比单 AI 多赚超过三成！越遇断供和价格战优势越明显，风控更是百分百通过。",
    ),
    Segment(
        idx=24,
        kind="end_clip",
        src_start=420.5,
        src_end=429.5,
        narration="最后切回首页，刚才拍板的每份方案都完整存在右侧历史记录里，随时点开就能回放。算得准、自动省广告费、断供会砍价、账目防篡改，让普通卖家也能轻松用上靠谱的 AI 参谋团队。感谢观看！",
    ),
]


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD_PATH if bold else FONT_REG_PATH, size)


def run_cmd(cmd: list[str], cwd: Path | None = None) -> str:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
    return proc.stdout


def probe_duration(path: Path) -> float:
    out = run_cmd(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ]
    )
    return float(json.loads(out)["format"]["duration"])


def get_proxy_url() -> str | None:
    return (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("http_proxy")
    )


async def synth_one_tts(seg: Segment, mp3_path: Path, force: bool, sem: asyncio.Semaphore) -> None:
    sig_path = mp3_path.with_suffix(".txt")
    sig_content = f"{VOICE}|{VOICE_RATE}|{seg.narration}"
    if (
        not force
        and mp3_path.exists()
        and mp3_path.stat().st_size > 2048
        and sig_path.exists()
        and sig_path.read_text(encoding="utf-8") == sig_content
    ):
        return
    proxy = get_proxy_url()
    last_err: Exception | None = None
    async with sem:
        for attempt in range(1, 6):
            try:
                tmp_path = mp3_path.with_suffix(".tmp.mp3")
                comm = edge_tts.Communicate(
                    seg.narration,
                    VOICE,
                    rate=VOICE_RATE,
                    proxy=proxy,
                )
                await comm.save(str(tmp_path))
                if tmp_path.exists() and tmp_path.stat().st_size > 2048:
                    tmp_path.replace(mp3_path)
                    sig_path.write_text(sig_content, encoding="utf-8")
                    return
                raise RuntimeError("Empty TTS output")
            except Exception as err:  # noqa: BLE001
                last_err = err
                await asyncio.sleep(0.8 * attempt)
    raise RuntimeError(f"TTS failed for segment {seg.idx:02d}: {last_err}")


async def synth_all_tts(audio_dir: Path, force: bool) -> dict[int, tuple[Path, float]]:
    sem = asyncio.Semaphore(4)
    tasks = [
        synth_one_tts(seg, audio_dir / f"seg_{seg.idx:02d}.mp3", force, sem)
        for seg in SEGMENTS
    ]
    await asyncio.gather(*tasks)
    return {
        seg.idx: (
            audio_dir / f"seg_{seg.idx:02d}.mp3",
            probe_duration(audio_dir / f"seg_{seg.idx:02d}.mp3"),
        )
        for seg in SEGMENTS
    }


def split_subtitle_lines(text: str, max_chars: int = 24) -> list[str]:
    """Split Chinese narration into crisp single-line chunks <= max_chars."""
    raw_clauses = [c.strip() for c in re.split(r"(?<=[。！？；：，])", text) if c.strip()]
    merged: list[str] = []
    buf = ""
    for clause in raw_clauses:
        clean = clause.strip()
        if not clean:
            continue
        if len(buf) + len(clean) <= max_chars:
            buf += clean
        else:
            if buf:
                merged.append(buf.rstrip("，。；："))
            if len(clean) <= max_chars:
                buf = clean
            else:
                tokens = re.findall(r"[A-Za-z0-9.\-%]+|.", clean)
                cur = ""
                for tok in tokens:
                    if len(cur) + len(tok) > max_chars and cur:
                        merged.append(cur.strip().rstrip("，。；："))
                        cur = tok
                    else:
                        cur += tok
                buf = cur.strip()
    if buf:
        merged.append(buf.rstrip("，。；："))
    return merged


def build_segment_captions(
    seg: Segment,
    exact_dur: float,
    audio_dur: float,
    cap_dir: Path,
) -> list[tuple[Path, float, float]]:
    """Create floating translucent charcoal pill PNGs and local [start, end] times."""
    delay = 0.25 if seg.kind in ("start_hold", "end_clip") else 0.15
    speech_start = delay
    speech_end = min(exact_dur - 0.05, speech_start + audio_dur)
    chunks = split_subtitle_lines(seg.narration, max_chars=24)
    weights = [max(1, len(c)) for c in chunks]
    total_w = sum(weights)
    span = max(0.5, speech_end - speech_start)

    font = load_font(27, bold=True)
    probe_im = Image.new("RGBA", (10, 10))
    pdraw = ImageDraw.Draw(probe_im)

    items: list[tuple[Path, float, float]] = []
    cur = speech_start
    for idx, (chunk, w) in enumerate(zip(chunks, weights)):
        dur = span * (w / total_w)
        nxt = speech_end if idx == len(chunks) - 1 else cur + dur

        tb = pdraw.textbbox((0, 0), chunk, font=font)
        tw = tb[2] - tb[0]
        th = tb[3] - tb[1]
        pw = tw + 52
        if pw % 2 == 1:
            pw += 1
        ph = 52

        pill = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        draw = ImageDraw.Draw(pill)
        draw.rounded_rectangle(
            [0, 0, pw - 1, ph - 1],
            radius=14,
            fill=CHARCOAL_PILL_RGBA,
            outline=PILL_BORDER_RGBA,
            width=1,
        )
        tx = (pw - tw) // 2 - tb[0]
        ty = (ph - th) // 2 - tb[1] - 1
        draw.text((tx + 1, ty + 1), chunk, font=font, fill=(0, 0, 0, 135))
        draw.text((tx, ty), chunk, font=font, fill=WHITE_RGB + (255,))

        png_path = cap_dir / f"seg_{seg.idx:02d}_cap_{idx:02d}.png"
        pill.save(png_path)
        items.append((png_path, cur, nxt))
        cur = nxt
    return items


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int] | tuple[int, int, int, int],
    cx: int,
) -> None:
    tb = draw.textbbox((0, 0), text, font=font)
    tw = tb[2] - tb[0]
    draw.text((cx - tw // 2 - tb[0], y - tb[1]), text, font=font, fill=fill)


def render_timelapse_clip(
    seg: Segment,
    input_mp4: Path,
    audio_mp3: Path,
    captions: list[tuple[Path, float, float]],
    exact_dur: float,
    n_frames: int,
    out_mkv: Path,
) -> None:
    """Render the 2m30s live LLM benchmark wait with a frosted-charcoal stopwatch card."""
    raw_vid = out_mkv.with_suffix(".raw.mp4")
    cap = cv2.VideoCapture(str(input_mp4))
    loaded_pills = [(Image.open(p).convert("RGBA"), s, e) for p, s, e in captions]

    f_pill = load_font(21, bold=True)
    f_clock_lbl = load_font(25, bold=True)
    f_clock = load_font(72, bold=True)
    f_desc1 = load_font(25, bold=True)
    f_desc2 = load_font(21, bold=False)

    card_w, card_h = 1180, 336
    card_x = (OUT_W - card_w) // 2
    card_y = (OUT_H - card_h) // 2 - 20
    card_base = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(card_base)
    cdraw.rounded_rectangle(
        [0, 0, card_w - 1, card_h - 1],
        radius=22,
        fill=CHARCOAL_CARD_RGBA,
        outline=CARD_BORDER_RGBA,
        width=2,
    )

    badge_txt = "真实 AI 大模型实时跑分中 · 演示加速跳过等待"
    tb = cdraw.textbbox((0, 0), badge_txt, font=f_pill)
    bw = (tb[2] - tb[0]) + 42
    bx = (card_w - bw) // 2
    cdraw.rounded_rectangle(
        [bx, 24, bx + bw, 64],
        radius=20,
        fill=(44, 38, 30, 255),
        outline=GOLD_RGB + (255,),
        width=2,
    )
    draw_centered_text(cdraw, 31, badge_txt, f_pill, GOLD_RGB, cx=card_w // 2)
    draw_centered_text(
        cdraw,
        222,
        "后台正实时连接 DeepSeek，同卷实测 12 道选品题 + 3 场 8 回合开店实战",
        f_desc1,
        WHITE_RGB,
        cx=card_w // 2,
    )
    draw_centered_text(
        cdraw,
        270,
        "真实耗时约 2 分 30 秒，此处仅快进跳过等待画面，最终成绩 100% 真实无删改",
        f_desc2,
        MUTED_RGB,
        cx=card_w // 2,
    )

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(raw_vid), fourcc, FPS, (OUT_W, OUT_H))
    src_span = seg.src_end - seg.src_start
    total_real_secs = 150.0

    for i in range(n_frames):
        t_sec = i / FPS
        progress = i / max(1, n_frames - 1)
        src_t = seg.src_start + progress * src_span
        cap.set(cv2.CAP_PROP_POS_MSEC, src_t * 1000.0)
        ok, frame = cap.read()
        if not ok:
            break
        cropped = frame[CROP_Y : CROP_Y + CROP_H, CROP_X : CROP_X + CROP_W]
        dimmed = cv2.convertScaleAbs(cropped, alpha=0.62, beta=0)
        canvas = np.full((OUT_H, OUT_W, 3), PAPER_RGB[::-1], dtype=np.uint8)
        canvas[:, 1 : 1 + CROP_W] = dimmed

        pil_frame = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)).convert("RGBA")
        pil_frame.alpha_composite(card_base, (card_x, card_y))

        fdraw = ImageDraw.Draw(pil_frame)
        cur_sec = int(round(progress * total_real_secs))
        mm, ss = divmod(cur_sec, 60)
        clock_str = f"{mm:02d}:{ss:02d}  /  02:30"
        draw_centered_text(fdraw, card_y + 94, "真实跑分计时", f_clock_lbl, GOLD_RGB, cx=card_x + 335)
        draw_centered_text(fdraw, card_y + 88, clock_str, f_clock, WHITE_RGB, cx=card_x + 715)

        bar_x1 = card_x + 110
        bar_x2 = card_x + card_w - 110
        bar_y1 = card_y + 188
        bar_y2 = bar_y1 + 14
        fdraw.rounded_rectangle([bar_x1, bar_y1, bar_x2, bar_y2], radius=7, fill=(52, 48, 42))
        fill_w = max(14, int((bar_x2 - bar_x1) * progress))
        fdraw.rounded_rectangle([bar_x1, bar_y1, bar_x1 + fill_w, bar_y2], radius=7, fill=EMERALD_RGB)

        for pill_im, ps, pe in loaded_pills:
            if ps <= t_sec <= pe:
                px = (OUT_W - pill_im.width) // 2
                py = OUT_H - pill_im.height - 20
                pil_frame.alpha_composite(pill_im, (px, py))
                break

        writer.write(cv2.cvtColor(np.array(pil_frame.convert("RGB")), cv2.COLOR_RGB2BGR))

    writer.release()
    cap.release()

    run_cmd(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(raw_vid),
            "-i",
            str(audio_mp3),
            "-filter_complex",
            f"[1:a]adelay=150|150,apad,atrim=0:{exact_dur:.6f},asetpts=PTS-STARTPTS[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(out_mkv),
        ]
    )


def render_standard_clip(
    seg: Segment,
    input_mp4: Path,
    audio_mp3: Path,
    captions: list[tuple[Path, float, float]],
    exact_dur: float,
    out_mkv: Path,
) -> None:
    src_dur = seg.src_end - seg.src_start
    speed = src_dur / exact_dur

    if seg.kind == "start_hold":
        # Pause gracefully on the crisp live dashboard at t=0, then play 0->6.6s smoothly
        hold_dur = max(1.0, exact_dur - src_dur)
        retime_chain = (
            f"tpad=start_mode=clone:start_duration={hold_dur:.6f},"
            f"fade=t=in:st=0:d=0.45"
        )
        delay_ms = 250
    elif seg.kind == "end_clip":
        # Play 420.5->429.5 at 0.88x, hold on saved-history home view, fade out gently
        slow_factor = 1.0 / 0.88
        motion_dur = src_dur * slow_factor
        hold_dur = max(0.0, exact_dur - motion_dur)
        fade_st = max(0.5, exact_dur - 0.80)
        pad_part = f",tpad=stop_mode=clone:stop_duration={hold_dur:.6f}" if hold_dur > 0.04 else ""
        retime_chain = f"setpts={slow_factor:.6f}*PTS{pad_part},fade=t=out:st={fade_st:.3f}:d=0.80"
        delay_ms = 250
    elif seg.allow_fast or (0.68 <= speed <= 2.15):
        pts_factor = exact_dur / src_dur
        retime_chain = f"setpts={pts_factor:.6f}*PTS"
        delay_ms = 150
    elif speed < 0.68:
        slow_factor = 1.0 / 0.88
        motion_dur = src_dur * slow_factor
        hold_dur = max(0.0, exact_dur - motion_dur)
        if hold_dur > 0.04:
            retime_chain = f"setpts={slow_factor:.6f}*PTS,tpad=stop_mode=clone:stop_duration={hold_dur:.6f}"
        else:
            retime_chain = f"setpts={exact_dur / src_dur:.6f}*PTS"
        delay_ms = 150
    else:
        pts_factor = exact_dur / src_dur
        retime_chain = f"setpts={pts_factor:.6f}*PTS"
        delay_ms = 150

    cmd: list[str] = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{seg.src_start:.3f}",
        "-t",
        f"{src_dur:.3f}",
        "-i",
        str(input_mp4),
        "-i",
        str(audio_mp3),
    ]
    for cap_png, _, _ in captions:
        cmd.extend(["-loop", "1", "-t", f"{exact_dur:.6f}", "-i", str(cap_png)])

    filters: list[str] = [
        f"[0:v]crop={CROP_W}:{CROP_H}:{CROP_X}:{CROP_Y},"
        f"pad={OUT_W}:{OUT_H}:1:0:color={PAPER_HEX},"
        f"{retime_chain},fps={FPS},trim=duration={exact_dur:.6f},setpts=PTS-STARTPTS[v0]"
    ]
    cur_label = "v0"
    for i, (_, s, e) in enumerate(captions):
        in_idx = i + 2
        nxt_label = f"v{i + 1}"
        filters.append(
            f"[{cur_label}][{in_idx}:v]overlay=x=(W-w)/2:y=H-h-20:enable='between(t,{s:.3f},{e:.3f})'[{nxt_label}]"
        )
        cur_label = nxt_label

    filters.append(f"[{cur_label}]format=yuv420p[vout]")
    filters.append(
        f"[1:a]adelay={delay_ms}|{delay_ms},apad,atrim=0:{exact_dur:.6f},asetpts=PTS-STARTPTS[aout]"
    )

    cmd.extend(
        [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(FPS),
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(out_mkv),
        ]
    )
    run_cmd(cmd)


def fmt_srt_time(sec: float) -> str:
    ms = max(0, int(round(sec * 1000)))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, ms_rem = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms_rem:03d}"


def write_srt(global_captions: list[tuple[str, float, float]], srt_path: Path) -> None:
    lines: list[str] = []
    for idx, (text, s, e) in enumerate(global_captions, start=1):
        lines.append(f"{idx}\n{fmt_srt_time(s)} --> {fmt_srt_time(e)}\n{text}\n")
    srt_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build borderless narrated & pill-subtitled demo video.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--build-dir", type=Path, default=DEFAULT_BUILD_DIR)
    parser.add_argument("--force-tts", action="store_true")
    args = parser.parse_args()

    if not args.input.exists():
        raise FileNotFoundError(f"Missing input video: {args.input}")

    build_dir: Path = args.build_dir
    audio_dir = build_dir / "audio"
    cap_dir = build_dir / "captions"
    clips_dir = build_dir / "clips"
    for d in (build_dir, audio_dir, cap_dir, clips_dir):
        d.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] Synthesizing Chinese AI voiceover for {len(SEGMENTS)} segments...")
    audio_map = asyncio.run(synth_all_tts(audio_dir, force=args.force_tts))

    print("[2/4] Rendering 1920x940 borderless segments with frosted-charcoal pill captions...")
    clip_paths: list[Path] = []
    global_captions: list[tuple[str, float, float]] = []
    global_cursor = 0.0

    for seg in SEGMENTS:
        mp3_path, audio_dur = audio_map[seg.idx]
        if seg.kind == "start_hold":
            target_dur = audio_dur + 0.70
        elif seg.kind == "end_clip":
            target_dur = audio_dur + 1.30
        else:
            target_dur = audio_dur + 0.45

        n_frames = max(1, round(target_dur * FPS))
        exact_dur = n_frames / FPS

        captions = build_segment_captions(seg, exact_dur, audio_dur, cap_dir)
        chunks = split_subtitle_lines(seg.narration, max_chars=24)
        for text, (_, ls, le) in zip(chunks, captions):
            global_captions.append((text, global_cursor + ls, global_cursor + le))

        out_mkv = clips_dir / f"clip_{seg.idx:02d}.mkv"
        clip_paths.append(out_mkv)

        print(
            f"  - Seg {seg.idx:02d} [{seg.kind:10s}] src={seg.src_start:5.1f}-{seg.src_end:5.1f}s "
            f"audio={audio_dur:5.2f}s -> exact={exact_dur:5.2f}s ({len(captions)} pills)"
        )

        if seg.kind == "timelapse":
            render_timelapse_clip(seg, args.input, mp3_path, captions, exact_dur, n_frames, out_mkv)
        else:
            render_standard_clip(seg, args.input, mp3_path, captions, exact_dur, out_mkv)

        global_cursor += exact_dur

    write_srt(global_captions, build_dir / "subtitles.srt")

    print(f"[3/4] Concatenating {len(clip_paths)} lossless MKV segments (total {global_cursor:.2f}s)...")
    concat_txt = build_dir / "concat.txt"
    concat_txt.write_text(
        "\n".join(f"file '{p.as_posix()}'" for p in clip_paths) + "\n",
        encoding="utf-8",
    )
    merged_mkv = build_dir / "merged.mkv"
    run_cmd(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_txt),
            "-c",
            "copy",
            str(merged_mkv),
        ]
    )

    print("[4/4] Final encode with broadcast loudness normalization (-16 LUFS)...")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    run_cmd(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(merged_mkv),
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(args.output.resolve()),
        ]
    )

    final_dur = probe_duration(args.output)
    size_mb = args.output.stat().st_size / (1024 * 1024)
    print(f"DONE! Output: {args.output} ({final_dur:.2f}s, {size_mb:.1f} MB)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

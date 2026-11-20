"""Generate the defense presentation PPTX strictly on top of the official template.

Template: docs/2026未来杯PPT模版.pptx
Output:   docs/AgentOps-Harness-答辩PPT.pptx

Preserves all template masters, layouts, header logos, backgrounds, and typography:
- Cover title: 思源黑体 CN Bold, 32pt, no guillemets (不加书名号)
- Cover metadata (team/presenter/advisor/school): 思源黑体 CN Bold, 20pt
- TOC level-1 (1, 2, 3): 思源黑体 CN Bold, 20pt
- TOC level-2 (1.1, 2.1, 3.1): 思源黑体 CN Normal, 18pt
- Section divider titles & content slide sub-titles: 思源黑体 CN Bold, 24pt
- Closing slide: Template's 谢谢观看 / Thanks
- Removes the organizer's instruction slide (大会PPT提示) while obeying all 4 rules.
"""

from __future__ import annotations

from pathlib import Path
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml import parse_xml
from pptx.oxml.ns import nsdecls, qn
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PPTX = ROOT / "docs" / "2026未来杯PPT模版.pptx"
OUTPUT_PPTX = ROOT / "docs" / "AgentOps-Harness-答辩PPT.pptx"
SHOT_DIR = ROOT / "artifacts" / "whitepaper"

FONT_BOLD = "思源黑体 CN Bold"
FONT_NORMAL = "思源黑体 CN Normal"

# Palette harmonized with the official 2026 未来杯 blue theme (#036DB7)
C_PRIMARY = RGBColor(0x03, 0x6D, 0xB7)     # Official template blue
C_PRIMARY_DARK = RGBColor(0x09, 0x35, 0x6E)
C_PRIMARY_LIGHT = RGBColor(0xEB, 0xF4, 0xFC)
C_DARK_GLASS = RGBColor(0x09, 0x26, 0x5E)
C_DARK_BORDER = RGBColor(0x3B, 0x7A, 0xC9)

C_INK = RGBColor(0x1B, 0x23, 0x30)
C_MUTED = RGBColor(0x4E, 0x59, 0x69)
C_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
C_SOFT_BG = RGBColor(0xF5, 0xF8, 0xFC)
C_BORDER = RGBColor(0xD3, 0xDF, 0xEE)

C_CRIMSON = RGBColor(0xC4, 0x44, 0x2B)
C_CRIMSON_LIGHT = RGBColor(0xFA, 0xED, 0xEA)
C_JADE = RGBColor(0x1E, 0x6E, 0x54)
C_JADE_LIGHT = RGBColor(0xEA, 0xF5, 0xF0)
C_OCHRE = RGBColor(0xB0, 0x74, 0x1E)
C_OCHRE_LIGHT = RGBColor(0xFA, 0xF3, 0xE6)
C_LIGHT_TEXT = RGBColor(0xF2, 0xF6, 0xFC)
C_LIGHT_SUB = RGBColor(0xC6, 0xDA, 0xF4)


def apply_font(
    run,
    size_pt: float,
    bold: bool = False,
    color: RGBColor | None = C_INK,
    scheme_val: str | None = None,
) -> None:
    """Apply template-exact 思源黑体 CN Bold/Normal to latin, ea, and cs."""
    font_name = FONT_BOLD if bold else FONT_NORMAL
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    if scheme_val is not None:
        rPr = run._r.get_or_add_rPr()
        solid = rPr.find(qn("a:solidFill"))
        if solid is not None:
            rPr.remove(solid)
        rPr.append(parse_xml(f'<a:solidFill {nsdecls("a")}><a:schemeClr val="{scheme_val}"/></a:solidFill>'))
    elif color is not None:
        run.font.color.rgb = color

    rPr = run._r.get_or_add_rPr()
    for tag in ("a:latin", "a:ea", "a:cs"):
        child = rPr.find(qn(tag))
        if child is None:
            child = parse_xml(f'<{tag} {nsdecls("a")} typeface="{font_name}"/>')
            rPr.append(child)
        else:
            child.set("typeface", font_name)


def clear_text_frame(tf) -> None:
    p0 = tf.paragraphs[0]
    for extra_p in list(tf.paragraphs[1:]):
        extra_p._p.getparent().remove(extra_p._p)
    for r in list(p0.runs):
        r._r.getparent().remove(r._r)


def add_rect(
    slide,
    left: float,
    top: float,
    width: float,
    height: float,
    fill_color: RGBColor,
    line_color: RGBColor | None = None,
    line_width_pt: float = 1.0,
    rounded: bool = False,
):
    shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE
    shape = slide.shapes.add_shape(
        shape_type, Inches(left), Inches(top), Inches(width), Inches(height)
    )
    if rounded:
        shape.adjustments[0] = 0.04
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    if line_color is not None:
        shape.line.color.rgb = line_color
        shape.line.width = Pt(line_width_pt)
    else:
        shape.line.fill.background()
    return shape


def add_textbox(
    slide,
    left: float,
    top: float,
    width: float,
    height: float,
    text: str = "",
    size_pt: float = 14,
    bold: bool = False,
    color: RGBColor = C_INK,
    align=PP_ALIGN.LEFT,
    valign=MSO_ANCHOR.TOP,
    line_spacing: float = 1.2,
    margin_lr: float = 0.04,
    margin_tb: float = 0.02,
):
    tb = slide.shapes.add_textbox(
        Inches(left), Inches(top), Inches(width), Inches(height)
    )
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = valign
    tf.margin_left = Inches(margin_lr)
    tf.margin_right = Inches(margin_lr)
    tf.margin_top = Inches(margin_tb)
    tf.margin_bottom = Inches(margin_tb)
    if text:
        p = tf.paragraphs[0]
        p.alignment = align
        p.line_spacing = line_spacing
        run = p.add_run()
        run.text = text
        apply_font(run, size_pt=size_pt, bold=bold, color=color)
    return tf


def add_paragraphs(
    tf,
    items: list[tuple[str, str]],
    title_pt: float = 13.0,
    body_pt: float = 11.5,
    title_color: RGBColor = C_INK,
    body_color: RGBColor = C_MUTED,
    space_after_pt: float = 4,
    line_spacing: float = 1.18,
) -> None:
    for idx, (lead, body) in enumerate(items):
        p = tf.paragraphs[0] if idx == 0 else tf.add_paragraph()
        p.space_after = Pt(space_after_pt)
        p.line_spacing = line_spacing
        if lead:
            r1 = p.add_run()
            r1.text = lead
            apply_font(r1, size_pt=title_pt, bold=True, color=title_color)
        if body:
            r2 = p.add_run()
            r2.text = body
            apply_font(r2, size_pt=body_pt, bold=False, color=body_color)


def add_content_title(
    slide,
    title: str,
    chapter_badge: str,
    page_num: int,
    total_pages: int,
) -> None:
    """Use exact template content title position (0.39, 0.90) & 24pt Bold 思源黑体 CN Bold."""
    # 小标题（思源黑体 CN Bold，24号）at exact template position
    add_textbox(
        slide,
        0.39,
        0.90,
        9.40,
        0.58,
        text=title,
        size_pt=24,
        bold=True,
        color=C_INK,
        valign=MSO_ANCHOR.MIDDLE,
    )
    # Chapter badge on top right below blue header bar
    pill = add_rect(
        slide, 10.05, 1.01, 2.75, 0.34, C_PRIMARY_LIGHT, C_PRIMARY, 0.75, rounded=True
    )
    pill.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = pill.text_frame.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = chapter_badge
    apply_font(r, size_pt=10.5, bold=True, color=C_PRIMARY)

    # Subtle separator line under title
    add_rect(slide, 0.45, 1.50, 12.43, 0.015, C_BORDER)

    # Clean centered footer (avoids bottom-left/bottom-right cyan waves)
    add_textbox(
        slide,
        3.20,
        7.05,
        6.93,
        0.28,
        text=f"AgentOps Harness · 三分拙劲破天下（岭南师范学院）  |  {page_num} / {total_pages}",
        size_pt=9.5,
        bold=False,
        color=C_MUTED,
        align=PP_ALIGN.CENTER,
    )


def add_section_divider(
    slide,
    num_str: str,
    title: str,
    subtitle: str,
    highlights: list[str],
    page_num: int,
    total_pages: int,
) -> None:
    """Use Layout 3 ('节标题') matching Template Slide 3."""
    # Exact template title position (0.39, 0.90) with 24pt Bold white
    add_textbox(
        slide,
        0.39,
        0.90,
        8.5,
        0.65,
        text=title,
        size_pt=24,
        bold=True,
        color=C_WHITE,
        valign=MSO_ANCHOR.MIDDLE,
    )

    # Center card showcasing chapter number, secondary title (18pt Normal), and 3 pillars
    add_textbox(
        slide,
        0.90,
        1.95,
        2.6,
        1.15,
        text=f"PART {num_str}",
        size_pt=40,
        bold=True,
        color=RGBColor(0x6D, 0xAE, 0xFF),
    )
    add_textbox(
        slide,
        0.90,
        2.88,
        11.5,
        0.55,
        text=title,
        size_pt=24,
        bold=True,
        color=C_WHITE,
        valign=MSO_ANCHOR.MIDDLE,
    )
    add_textbox(
        slide,
        0.90,
        3.50,
        11.5,
        0.45,
        text=subtitle,
        size_pt=18,
        bold=False,
        color=C_LIGHT_SUB,
        valign=MSO_ANCHOR.MIDDLE,
    )

    x = 0.90
    for item in highlights:
        w = 3.62
        add_rect(slide, x, 4.42, w, 1.02, C_DARK_GLASS, C_DARK_BORDER, 1.0, rounded=True)
        add_rect(slide, x, 4.42, 0.09, 1.02, RGBColor(0x3B, 0xC4, 0xF2))
        add_textbox(
            slide,
            x + 0.24,
            4.50,
            w - 0.36,
            0.86,
            text=item,
            size_pt=12.5,
            bold=False,
            color=C_LIGHT_TEXT,
            valign=MSO_ANCHOR.MIDDLE,
            line_spacing=1.22,
        )
        x += w + 0.32

    add_textbox(
        slide,
        5.40,
        7.05,
        2.53,
        0.28,
        text=f"{page_num} / {total_pages}",
        size_pt=9.5,
        bold=True,
        color=C_LIGHT_SUB,
        align=PP_ALIGN.CENTER,
    )


def add_picture_fit(
    slide,
    img_path: Path,
    left: float,
    top: float,
    max_w: float,
    max_h: float,
) -> tuple[float, float, float, float]:
    with Image.open(img_path) as im:
        px_w, px_h = im.size
    ratio = px_w / px_h
    box_ratio = max_w / max_h
    if ratio >= box_ratio:
        w = max_w
        h = max_w / ratio
        x = left
        y = top + (max_h - h) / 2
    else:
        h = max_h
        w = max_h * ratio
        x = left + (max_w - w) / 2
        y = top
    slide.shapes.add_picture(str(img_path), Inches(x), Inches(y), Inches(w), Inches(h))
    return x, y, w, h


def style_table(
    table,
    headers: list[str],
    rows: list[list[str]],
    col_widths: list[float],
    font_pt: float = 10.5,
    header_bg: RGBColor = C_PRIMARY_DARK,
    highlight_last_row: bool = False,
) -> None:
    for c_idx, w in enumerate(col_widths):
        table.columns[c_idx].width = Inches(w)

    for c_idx, h_text in enumerate(headers):
        cell = table.cell(0, c_idx)
        cell.fill.solid()
        cell.fill.fore_color.rgb = header_bg
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        cell.margin_left = Inches(0.08)
        cell.margin_right = Inches(0.08)
        cell.margin_top = Inches(0.04)
        cell.margin_bottom = Inches(0.04)
        p = cell.text_frame.paragraphs[0]
        p.alignment = PP_ALIGN.LEFT if c_idx == 0 else PP_ALIGN.CENTER
        r = p.add_run()
        r.text = h_text
        apply_font(r, size_pt=font_pt, bold=True, color=C_WHITE)

    for r_idx, row_vals in enumerate(rows, start=1):
        is_hl = highlight_last_row and r_idx == len(rows)
        row_bg = C_JADE_LIGHT if is_hl else (C_WHITE if r_idx % 2 == 1 else C_SOFT_BG)
        for c_idx, val in enumerate(row_vals):
            cell = table.cell(r_idx, c_idx)
            cell.fill.solid()
            cell.fill.fore_color.rgb = row_bg
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = Inches(0.08)
            cell.margin_right = Inches(0.08)
            cell.margin_top = Inches(0.04)
            cell.margin_bottom = Inches(0.04)
            p = cell.text_frame.paragraphs[0]
            p.alignment = PP_ALIGN.LEFT if c_idx == 0 or len(val) > 15 else PP_ALIGN.CENTER
            r = p.add_run()
            r.text = val
            apply_font(
                r,
                size_pt=font_pt,
                bold=(is_hl or c_idx == 0),
                color=C_JADE if is_hl else C_INK,
            )


def delete_slide(prs: Presentation, slide_index: int) -> None:
    sldIdLst = prs.slides._sldIdLst
    sldId = list(sldIdLst)[slide_index]
    rId = sldId.rId
    prs.part.drop_rel(rId)
    sldIdLst.remove(sldId)


def move_slide(prs: Presentation, old_index: int, new_index: int) -> None:
    sldIdLst = prs.slides._sldIdLst
    slides = list(sldIdLst)
    el = slides[old_index]
    sldIdLst.remove(el)
    sldIdLst.insert(new_index, el)


def build_deck() -> None:
    prs = Presentation(str(TEMPLATE_PPTX))
    layout_section = prs.slide_layouts[3]  # 节标题 (deep blue template bg)
    layout_content = prs.slide_layouts[2]  # 两栏内容 (white + top blue header + bottom waves)

    # Template currently has 6 slides:
    # 0: Cover, 1: TOC, 2: Section sample, 3: Content sample, 4: Reminder, 5: Closing (Thanks)
    # Delete slides 2..5 in reverse order so only slide1.xml & slide2.xml remain (no partname collision!)
    delete_slide(prs, 5)  # 谢谢观看 (will be recreated cleanly on layout 0 at the end)
    delete_slide(prs, 4)  # 大会PPT提示
    delete_slide(prs, 3)  # 示例内容页
    delete_slide(prs, 2)  # 示例节标题页
    # Remaining slides: 0=Cover (slide1.xml), 1=TOC (slide2.xml)

    total_pages = 14

    # =========================================================================
    # Slide 1 (index 0): 封面页 —— 直接修改模板原文本框
    # 演讲题目: 思源黑体 CN Bold, 32号, 不加书名号
    # 团队名称/演讲人/指导教师/学校: 思源黑体 CN Bold, 20号
    # =========================================================================
    s1 = prs.slides[0]
    title_shape = s1.shapes[0]
    tf_title = title_shape.text_frame
    clear_text_frame(tf_title)
    p = tf_title.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "AgentOps Harness：可信多智能体编排与验证平台"
    apply_font(r, size_pt=32, bold=True, color=None, scheme_val="bg1")

    meta_shape = s1.shapes[1]
    tf_meta = meta_shape.text_frame
    clear_text_frame(tf_meta)
    meta_lines = [
        "团队名称：三分拙劲破天下",
        "演讲人：冯茂盛、陈子浩、丁泓江",
        "指导教师：无",
        "学校：岭南师范学院",
    ]
    for idx, line in enumerate(meta_lines):
        mp = tf_meta.paragraphs[0] if idx == 0 else tf_meta.add_paragraph()
        mp.alignment = PP_ALIGN.CENTER
        mp.line_spacing = 1.35
        mr = mp.add_run()
        mr.text = line
        apply_font(mr, size_pt=20, bold=True, color=None, scheme_val="bg1")

    # =========================================================================
    # Slide 2 (index 1): 目录页 —— 直接修改模板原文本框
    # 1/2/3 目录标题: 思源黑体 CN Bold, 20号
    # 1.1/2.1/3.1 二级标题: 思源黑体 CN Normal, 18号
    # =========================================================================
    s2 = prs.slides[1]
    toc_shape = s2.shapes[0]
    # Widen slightly within right area so 1.1/2.1/3.1 sits on 1 clean line without overflow
    toc_shape.left = Inches(5.35)
    toc_shape.top = Inches(2.20)
    toc_shape.width = Inches(6.95)
    toc_shape.height = Inches(3.60)
    tf_toc = toc_shape.text_frame
    tf_toc.word_wrap = True
    clear_text_frame(tf_toc)

    toc_entries = [
        ("1 项目背景与架构设计", "      1.1 行业痛点与四层隔离编排架构"),
        ("2 核心机制与平台实现", "      2.1 多维动态调度、双层闭环与防篡改审计"),
        ("3 实机演示与评测验证", "      3.1 三大工作台实证、消融跑分与 AI 边界"),
    ]
    for idx, (lvl1, lvl2) in enumerate(toc_entries):
        p1 = tf_toc.paragraphs[0] if idx == 0 else tf_toc.add_paragraph()
        p1.space_before = Pt(8 if idx > 0 else 0)
        p1.space_after = Pt(4)
        r1 = p1.add_run()
        r1.text = lvl1
        apply_font(r1, size_pt=20, bold=True, color=None, scheme_val="bg1")

        p2 = tf_toc.add_paragraph()
        p2.space_after = Pt(10)
        r2 = p2.add_run()
        r2.text = lvl2
        apply_font(r2, size_pt=18, bold=False, color=None, scheme_val="bg1")

    # =========================================================================
    # Slide 3: 第 1 章过渡页 (Layout 3 节标题)
    # =========================================================================
    s3 = prs.slides.add_slide(layout_section)
    add_section_divider(
        s3,
        "01",
        "1 项目背景与架构设计",
        "1.1 行业痛点与四层隔离编排架构",
        [
            "痛点：算术幻觉 / 群聊失控 /\nL1~L8 仿真泄漏 / 过程黑盒",
            "选型：自研事件溯源内核\n替代黑盒图框架与自由群聊",
            "隔离：4 层物理隔离边界\n与三态类型 + 整数分精度",
        ],
        3,
        total_pages,
    )

    # =========================================================================
    # Slide 4: 1.1a 行业痛点与技术选型 (Layout 2 两栏内容)
    # =========================================================================
    s4 = prs.slides.add_slide(layout_content)
    add_content_title(s4, "1.1 行业痛点与自研事件溯源内核选型", "1 项目背景与架构设计", 4, total_pages)

    add_textbox(s4, 0.45, 1.60, 5.9, 0.32, text="多智能体商业落地的四大工程痛点", size_pt=14.5, bold=True, color=C_PRIMARY)
    pains = [
        ("1. 算术幻觉与财务失真", "大模型心算平台抽成、退货摊销与现金流易出错，按建议上架后每卖一单亏一单。", C_CRIMSON),
        ("2. 单 Agent 盲从与群聊失控", "单 Agent 无制衡迎合目标；自由群聊路由不可控、风险点散落对话，难以工程审计。", C_OCHRE),
        ("3. 仿真回滚与未来泄漏 (L1~L8)", "结果窥视、重掷骰子挑最优、评测预算不对等、快照篡改与随机流共用，虚增利润。", C_PRIMARY),
        ("4. 过程黑盒与责任边界模糊", "缺调度打分透明记录，无法分辨「真模型推理」还是「规则回退」，关键决策无防篡改凭证。", C_JADE),
    ]
    py = 1.98
    for head, desc, acc in pains:
        add_rect(s4, 0.45, py, 5.95, 1.10, C_WHITE, C_BORDER, 1.0, rounded=True)
        add_rect(s4, 0.45, py, 0.08, 1.10, acc)
        tf = add_textbox(s4, 0.66, py + 0.08, 5.62, 0.94)
        add_paragraphs(tf, [(head + "\n", desc)], title_pt=12.8, body_pt=11.0, title_color=C_INK, body_color=C_MUTED, space_after_pt=2)
        py += 1.21

    add_textbox(s4, 6.65, 1.60, 6.2, 0.32, text="三条编排技术路线架构级取舍", size_pt=14.5, bold=True, color=C_JADE)
    t4 = s4.shapes.add_table(5, 4, Inches(6.65), Inches(1.98), Inches(6.23), Inches(2.90))
    style_table(
        t4.table,
        ["评估维度", "现成图框架\n(如 LangGraph)", "LLM 主管群聊\n(GroupChat)", "自研事件溯源内核\n(本项目采用)"],
        [
            ["调度透明度", "隐藏在第三方运行时", "模型口头路由易乱序", "白盒打分与理由逐条入链"],
            ["不可逆防回滚", "偏恢复，难防重算", "随机性高，难复现", "追加事件+唯一提交槽锁死"],
            ["工具权限隔离", "依赖提示词或钩子", "Function Calling 单层", "编译/注册期强拒写工具"],
            ["工程自主可控", "依赖外部框架语义", "缺乏图约束与预算", "100% 内核自研，跨行业复用"],
        ],
        [1.25, 1.58, 1.58, 1.82],
        font_pt=10.2,
    )
    for r_idx in range(1, 5):
        cell = t4.table.cell(r_idx, 3)
        cell.fill.solid()
        cell.fill.fore_color.rgb = C_PRIMARY_LIGHT
        for p in cell.text_frame.paragraphs:
            for r in p.runs:
                apply_font(r, size_pt=10.2, bold=True, color=C_PRIMARY_DARK)

    add_rect(s4, 6.65, 5.04, 6.23, 1.68, C_SOFT_BG, C_BORDER, 1.0, rounded=True)
    add_rect(s4, 6.65, 5.04, 0.08, 1.68, C_PRIMARY)
    add_textbox(s4, 6.86, 5.12, 5.88, 0.30, text="演示载体：电商全链路经营决策三大工作台", size_pt=13, bold=True, color=C_INK)
    wb_tf = add_textbox(s4, 6.86, 5.44, 5.88, 1.22)
    add_paragraphs(
        wb_tf,
        [
            ("1. 单品多维会签台：", "10 角色协作核算保本红线、三方压力质询与掌柜人工拍板。"),
            ("2. 8 回合动态博弈沙盘：", "断供 3 轮议价、价格战归零仲裁、热升级与防篡改账本。"),
            ("3. 4 拓扑评测竞技场：", "统一预算下公平对照 12 案单品难题与 8 回合 3 场景跑分。"),
        ],
        title_pt=11.0, body_pt=11.0, title_color=C_PRIMARY, body_color=C_INK, space_after_pt=3,
    )

    # =========================================================================
    # Slide 5: 1.1b 四层解耦架构与三态信息隔离
    # =========================================================================
    s5 = prs.slides.add_slide(layout_content)
    add_content_title(s5, "1.1 四层解耦总体架构与三态信息隔离机制", "1 项目背景与架构设计", 5, total_pages)

    add_textbox(s5, 0.45, 1.60, 6.6, 0.32, text="平台内核与业务模板物理隔离（test/boundary.test.ts 静态门禁）", size_pt=13.5, bold=True, color=C_INK)
    layers = [
        ("L1 交互可视化层  web/src/", "单品多维会签台  |  SimShop 8回合沙盘  |  4拓扑竞技场  |  大白话导览横幅", C_PRIMARY_LIGHT, C_PRIMARY),
        ("L2 服务与流式网关层  src/server/", "Hono REST & SSE 流式网关 (emittedAt 帧计时)  |  卷宗持久化  |  防篡改校验", C_OCHRE_LIGHT, C_OCHRE),
        ("L3 领域编排模板层  src/templates/", "agentops/ (10角色会签)  |  simshop/ (8回合博弈)  |  pricing/ & intake/  |  meeting/ (跨行业验证)", C_CRIMSON_LIGHT, C_CRIMSON),
        ("L4 自研事件溯源内核层  src/engine/  [零模板导入]", "声明式工作流执行器  |  动态调度与仲裁  |  4级验证与5重环  |  SQLite WAL + 幂等提交状态机", C_JADE_LIGHT, C_JADE),
    ]
    ly = 1.98
    for idx, (l_title, l_desc, bg, border_c) in enumerate(layers):
        add_rect(s5, 0.45, ly, 6.65, 1.00, bg, border_c, 1.25, rounded=True)
        add_textbox(s5, 0.62, ly + 0.10, 6.3, 0.32, text=l_title, size_pt=12.5, bold=True, color=border_c)
        add_textbox(s5, 0.62, ly + 0.44, 6.3, 0.46, text=l_desc, size_pt=10.8, bold=False, color=C_INK, line_spacing=1.15)
        if idx < 3:
            add_textbox(s5, 3.55, ly + 0.99, 0.5, 0.22, text="▼", size_pt=9.5, bold=True, color=C_MUTED, align=PP_ALIGN.CENTER)
        ly += 1.22

    add_textbox(s5, 7.35, 1.60, 5.5, 0.32, text="结构级防作弊：三态隔离与数值确定性", size_pt=13.5, bold=True, color=C_PRIMARY)
    add_rect(s5, 7.35, 1.98, 5.53, 2.26, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s5, 7.35, 1.98, 5.53, 0.36, C_PRIMARY_DARK)
    add_textbox(s5, 7.50, 2.00, 5.20, 0.32, text="三态类型隔离 (ScenarioTruth vs Observation vs PublicModel)", size_pt=11.5, bold=True, color=C_WHITE, valign=MSO_ANCHOR.MIDDLE)
    iso_tf = add_textbox(s5, 7.50, 2.40, 5.20, 1.76)
    add_paragraphs(
        iso_tf,
        [
            ("• ScenarioTruth（真实市场与未来日程）：", "仅纯结算函数 settle() 可读，Agent/工具/沙盘零引用权限。"),
            ("• Observation（合法投影快照）：", "project() 投影当期现金、库存、声誉与公开竞品价，扰动未来日程输出字节不变。"),
            ("• PublicModel（公开估计模型）：", "沙盘专用名义参数，随每回合真实成交缓慢修正，保持预测误差与学习价值。"),
        ],
        title_pt=11.0, body_pt=10.6, title_color=C_JADE, body_color=C_INK, space_after_pt=5,
    )

    add_rect(s5, 7.35, 4.38, 5.53, 1.12, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s5, 7.35, 4.38, 0.08, 1.12, C_OCHRE)
    c_tf = add_textbox(s5, 7.55, 4.46, 5.20, 0.96)
    add_paragraphs(
        c_tf,
        [("全链路整数「分」(Cents) + canonicalJson：", "货币禁用浮点数，入口品牌类型守卫拒收非法小数；字典序规范化序列化保证跨平台 SHA-256 指纹一致。")],
        title_pt=11.5, body_pt=10.6, title_color=C_OCHRE, body_color=C_INK,
    )

    add_rect(s5, 7.35, 5.62, 5.53, 1.10, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s5, 7.35, 5.62, 0.08, 1.10, C_PRIMARY)
    r_tf = add_textbox(s5, 7.55, 5.70, 5.20, 0.94)
    add_paragraphs(
        r_tf,
        [("哈希派生正交随机流：", "以 sha256(seed, stream, round, sku, k) 彻底隔离 settle（结算）、forecast（沙盘）与 events（危机卡），严防未来流泄漏（L7）。")],
        title_pt=11.5, body_pt=10.6, title_color=C_PRIMARY, body_color=C_INK,
    )

    # =========================================================================
    # Slide 6: 第 2 章过渡页 (Layout 3 节标题)
    # =========================================================================
    s6 = prs.slides.add_slide(layout_section)
    add_section_divider(
        s6,
        "02",
        "2 核心机制与平台实现",
        "2.1 多维动态调度、双层闭环与防篡改审计",
        [
            "编排：10 角色会签 + 17 节点 DAG\n与 SimShop 嵌套议价子流",
            "调度：resolveAgent() 评分\n+ 负边际归零 + 双层 Self-Loop",
            "风控：4 级安检门 + 零臆造数字\n+ SHA-256 幂等锁 (HTTP 409)",
        ],
        6,
        total_pages,
    )

    # =========================================================================
    # Slide 7: 2.1a 10 角色团队与双核心工作流
    # =========================================================================
    s7 = prs.slides.add_slide(layout_content)
    add_content_title(s7, "2.1 10 角色制衡团队与双核心声明式工作流", "2 核心机制与平台实现", 7, total_pages)

    add_textbox(s7, 0.45, 1.58, 7.9, 0.30, text="单品会签 10 大专业 Agent（AgentSpec 声明能力向量、白名单工具与调用预算）", size_pt=13, bold=True, color=C_INK)
    t7 = s7.shapes.add_table(6, 4, Inches(0.45), Inches(1.92), Inches(7.90), Inches(2.40))
    style_table(
        t7.table,
        ["角色组", "Agent 角色与版本", "核心职责与制衡立场", "白名单权限"],
        [
            ["规划与调研", "planner 1.2 / link-researcher 1.1", "拆解 DAG 与缺失项；标注事实/假设边界", "只读解析"],
            ["财务与市场", "cost-accountant 1.3 / market-analyst 1.0", "算保本红线；生成三套策略并回应质询", "量化计算"],
            ["三方压力质询", "采购负责人 / 定价参谋 / 推广运营", "成本+10%需求-30% / 毛利线 / 预算×1.5", "独立压力重估"],
            ["裁决与风控", "risk-auditor 1.4 / 独立主席", "消费 7+1 硬检查；按失败最少+p10裁决", "只读裁决"],
            ["合规与归档", "copywriter 1.0 / reporter 1.0", "限长禁用极限词文案；汇编可回放审计报告", "受控出稿"],
        ],
        [1.15, 2.40, 3.25, 1.10],
        font_pt=9.8,
    )

    add_rect(s7, 8.55, 1.58, 4.33, 2.74, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s7, 8.55, 1.58, 4.33, 0.34, C_PRIMARY_DARK)
    add_textbox(s7, 8.70, 1.60, 4.0, 0.30, text="9 种内核声明式工作流原语", size_pt=12, bold=True, color=C_WHITE, valign=MSO_ANCHOR.MIDDLE)
    prim_tf = add_textbox(s7, 8.70, 1.98, 4.05, 2.26)
    add_paragraphs(
        prim_tf,
        [
            ("• agent / tool：", "调度评分落链 + Zod 契约校验"),
            ("• parallel / condition：", "唯一所有权并行扇出 + 注册谓词分支"),
            ("• loop / subflow：", "强制正整数 maxIterations + 环路检测"),
            ("• verify / humanGate / commit：", "多级验签 + 掌柜人工门 + 不可逆封存"),
        ],
        title_pt=10.8, body_pt=10.5, title_color=C_PRIMARY, body_color=C_INK, space_after_pt=5,
    )

    add_rect(s7, 0.45, 4.44, 12.43, 1.14, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s7, 0.45, 4.44, 0.10, 1.14, C_CRIMSON)
    add_textbox(s7, 0.68, 4.50, 11.9, 0.28, text="工作流一：单品多方会签质询流 product-launch-review.v2（17 节点 DAG）", size_pt=12.5, bold=True, color=C_CRIMSON)
    wf1_steps = [
        ("预检门 preflight", "缺项主动追问\n拒编默认值", C_SOFT_BG),
        ("规划→研究→会计", "提取事实边界\n算保本底价", C_SOFT_BG),
        ("市场三套报价", "30天×200次\n蒙特卡洛模拟", C_SOFT_BG),
        ("三方并行质询", "采购/定价/推广\n压力重估+回应", C_OCHRE_LIGHT),
        ("主席裁决→修正环", "失败最少+p10\n定向调参<=2轮", C_CRIMSON_LIGHT),
        ("掌柜拍板→封存", "humanGate 门禁\nSHA-256 电子封条", C_JADE_LIGHT),
    ]
    sx = 0.68
    for idx, (st, sd, sbg) in enumerate(wf1_steps):
        add_rect(s7, sx, 4.82, 1.86, 0.66, sbg, C_BORDER, 0.75, rounded=True)
        add_textbox(s7, sx + 0.05, 4.84, 1.76, 0.24, text=st, size_pt=9.8, bold=True, color=C_INK, align=PP_ALIGN.CENTER)
        add_textbox(s7, sx + 0.05, 5.08, 1.76, 0.36, text=sd, size_pt=9.0, bold=False, color=C_MUTED, align=PP_ALIGN.CENTER, line_spacing=1.1)
        if idx < 5:
            add_textbox(s7, sx + 1.86, 4.98, 0.18, 0.28, text="→", size_pt=10.5, bold=True, color=C_CRIMSON, align=PP_ALIGN.CENTER)
        sx += 2.04

    add_rect(s7, 0.45, 5.68, 12.43, 1.14, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s7, 0.45, 5.68, 0.10, 1.14, C_JADE)
    add_textbox(s7, 0.68, 5.74, 11.9, 0.28, text="工作流二：SimShop 8 回合动态经营与嵌套议价流（12 阶段不可逆提交状态机）", size_pt=12.5, bold=True, color=C_JADE)
    wf2_steps = [
        ("1. planRound", "感知断供/价格战\n动态唤醒子流", C_SOFT_BG),
        ("2. 三角色并行", "buyer ∥ pricer\n∥ marketer", C_SOFT_BG),
        ("3. 价格战仲裁", "marginalBids 算增量\n负边际归零拦截", C_CRIMSON_LIGHT),
        ("4. 断供嵌套子流", "3 轮议价 + screenTalk\n防底价数字泄露", C_OCHRE_LIGHT),
        ("5. Critic 修正环", "5 重停机判据\n不通过启安全兜底", C_SOFT_BG),
        ("6. 封存与热升级", "不可逆结算落盘\npricer 1.0→1.0.1", C_JADE_LIGHT),
    ]
    sx = 0.68
    for idx, (st, sd, sbg) in enumerate(wf2_steps):
        add_rect(s7, sx, 6.06, 1.86, 0.66, sbg, C_BORDER, 0.75, rounded=True)
        add_textbox(s7, sx + 0.05, 6.08, 1.76, 0.24, text=st, size_pt=9.8, bold=True, color=C_INK, align=PP_ALIGN.CENTER)
        add_textbox(s7, sx + 0.05, 6.32, 1.76, 0.36, text=sd, size_pt=9.0, bold=False, color=C_MUTED, align=PP_ALIGN.CENTER, line_spacing=1.1)
        if idx < 5:
            add_textbox(s7, sx + 1.86, 6.22, 0.18, 0.28, text="→", size_pt=10.5, bold=True, color=C_JADE, align=PP_ALIGN.CENTER)
        sx += 2.04

    # =========================================================================
    # Slide 8: 2.1b 动态调度评分、边际仲裁与双层 Self-Loop
    # =========================================================================
    s8 = prs.slides.add_slide(layout_content)
    add_content_title(s8, "2.1 动态调度评分、边际仲裁与双层 Self-Loop", "2 核心机制与平台实现", 8, total_pages)

    add_textbox(s8, 0.45, 1.58, 6.0, 0.30, text="透明可解释的多维动态调度与现金仲裁", size_pt=14, bold=True, color=C_JADE)

    add_rect(s8, 0.45, 1.94, 6.05, 1.62, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s8, 0.45, 1.94, 0.08, 1.62, C_JADE)
    add_textbox(s8, 0.66, 2.00, 5.7, 0.28, text="1. 会签动态评分函数 resolveAgent()", size_pt=12.5, bold=True, color=C_INK)
    add_rect(s8, 0.66, 2.32, 5.66, 0.38, C_JADE_LIGHT, C_JADE, 0.75, rounded=True)
    add_textbox(
        s8, 0.70, 2.34, 5.58, 0.34,
        text="Score(a, c) = round(100 × Cap(a, c) - 9 × Load(a) - 15 × Fail(a), 2)",
        size_pt=10.2, bold=True, color=C_JADE, align=PP_ALIGN.CENTER, valign=MSO_ANCHOR.MIDDLE,
    )
    add_textbox(
        s8, 0.66, 2.76, 5.66, 0.74,
        text="• 先过滤能力与剩余调用预算，专职预算隔离防通用节点耗尽专家配额\n• 同分按 agent.id 字典序决胜保证 100% 确定性；候选全榜写入 dispatch.decided",
        size_pt=10.4, bold=False, color=C_MUTED, line_spacing=1.18,
    )

    add_rect(s8, 0.45, 3.66, 6.05, 1.46, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s8, 0.45, 3.66, 0.08, 1.46, C_OCHRE)
    tf8_2 = add_textbox(s8, 0.66, 3.74, 5.68, 1.30)
    add_paragraphs(
        tf8_2,
        [
            ("2. 内核信号调度 select() 与 SemVer 热升级发现\n",
             "规划器按观察信号（如 supply-cut）按需激活子流，内核校验依赖与能力阈值；latestAgents() 自动选取最高 SemVer（第 1 回合复盘写入补丁后，第 2 回合自动切换 pricer@1.0.1 并记录新 promptHash）。"),
        ],
        title_pt=12.5, body_pt=10.6, title_color=C_INK, body_color=C_MUTED,
    )

    add_rect(s8, 0.45, 5.22, 6.05, 1.54, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s8, 0.45, 5.22, 0.08, 1.54, C_CRIMSON)
    tf8_3 = add_textbox(s8, 0.66, 5.30, 5.68, 1.38)
    add_paragraphs(
        tf8_3,
        [
            ("3. 价格战边际收益现金仲裁 allocateBudget()\n",
             "竞品腰斩降价时，沙盘 marginalBids() 分别测算「跟降」与「加投流」边际净利增量；令 wᵢ = max(0, bidᵢ)。当二者皆为负值（如 -¥9.20 / -¥46.00）时触发负边际归零拦截（实配 ¥0.00），杜绝多卖多亏。"),
        ],
        title_pt=12.5, body_pt=10.6, title_color=C_INK, body_color=C_MUTED,
    )

    add_textbox(s8, 6.75, 1.58, 6.1, 0.30, text="可控收敛的双层 Self-Loop 与五重硬终止判据", size_pt=14, bold=True, color=C_CRIMSON)
    add_rect(s8, 6.75, 1.94, 6.13, 2.08, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_textbox(s8, 6.94, 2.02, 5.75, 0.28, text="产品层：定向经济修正环 planEconomicAdjustment()（上限 <= 2 轮）", size_pt=12, bold=True, color=C_CRIMSON)
    loop_tf = add_textbox(s8, 6.94, 2.34, 5.75, 1.62)
    add_paragraphs(
        loop_tf,
        [
            ("• ad-budget：", "推广占比 >20% 时按 60% 比例下调日推广预算（保底 100 分）。"),
            ("• promo-discount：", "活动折后价跌破保本时按公式上调折扣，确保站稳保本线。"),
            ("• switch-candidate：", "资金紧张/毛利不足时从「冲量」切换至更稳健方案。"),
            ("• 防空转停机：", "成本倒挂或缺失事实时直接停止，展示修正前后数值快照对比。"),
        ],
        title_pt=10.8, body_pt=10.5, title_color=C_INK, body_color=C_MUTED, space_after_pt=3,
    )

    add_textbox(s8, 6.75, 4.10, 6.1, 0.28, text="内核层：revisionStop() 五重硬终止条件 + 确定性兜底", size_pt=12, bold=True, color=C_INK)
    t8 = s8.shapes.add_table(6, 3, Inches(6.75), Inches(4.40), Inches(6.13), Inches(1.80))
    style_table(
        t8.table,
        ["终止条件", "触发判据", "防线作用"],
        [
            ["passed", "verdict === 'pass'", "硬检查全过且有效异议清零"],
            ["maxIterations", "iteration >= maxIterations (3)", "锁死单回合延迟与重试上界"],
            ["budget", "callsUsed >= callBudget", "防止单节点拖垮全局预算"],
            ["p50Plateau", "p50 - prevP50 < threshold", "中位利润改善停滞及时止损"],
            ["repeatedDecision", "seenHashes 命中重复哈希", "阻断 A→B→A 振荡死循环"],
        ],
        [1.55, 2.20, 2.38],
        font_pt=9.6,
    )
    add_rect(s8, 6.75, 6.26, 6.13, 0.50, C_OCHRE_LIGHT, C_OCHRE, 0.75, rounded=True)
    add_textbox(
        s8, 6.88, 6.28, 5.88, 0.46,
        text="非 pass 退出即触发 fallbackDecision()：维持上期价、广告归零、保守补货，硬约束 100% 满足。",
        size_pt=10.2, bold=True, color=C_INK, valign=MSO_ANCHOR.MIDDLE,
    )

    # =========================================================================
    # Slide 9: 2.1c 四级验证管线与 SHA-256 不可逆防篡改锁
    # =========================================================================
    s9 = prs.slides.add_slide(layout_content)
    add_content_title(s9, "2.1 四级递进验证与 SHA-256 不可逆防篡改锁", "2 核心机制与平台实现", 9, total_pages)

    add_textbox(s9, 0.45, 1.58, 6.0, 0.30, text="四级递进验证管线 + EvidenceLedger 反幻觉协议", size_pt=13.5, bold=True, color=C_INK)
    gates = [
        ("第一级：Zod 严格结构校验 (Schema Gate)", "z.strictObject 拦截缺项、非法小数分及未知字段，直接 reject。", C_PRIMARY),
        ("第二级：代码级领域硬约束 + 话术脱敏", "SimShop 4 项硬检（现金/产能/底价/广告）；会签 7+1 审计；screenTalk() 严禁谈判对白泄露采购底价数字。", C_CRIMSON),
        ("第三级：30 天 × 200 次蒙特卡洛沙盘", "对数正态需求波动 (σ=0.28) + 周转备货上限 + 平台账期延后回款，按悲观 p10 利润择优。", C_OCHRE),
        ("第四级：证据锚定 Critic + 零臆造数字审计", "无证据异议直接丢弃 (dropped)；模型评述经 assertNoInventedNumbers() 校验，剥离 p10/p50/p90 后禁含数字/货币符。", C_JADE),
    ]
    gy = 1.94
    for g_t, g_d, g_c in gates:
        add_rect(s9, 0.45, gy, 6.00, 1.12, C_WHITE, C_BORDER, 1.0, rounded=True)
        add_rect(s9, 0.45, gy, 0.08, 1.12, g_c)
        tfg = add_textbox(s9, 0.65, gy + 0.08, 5.66, 0.96)
        add_paragraphs(tfg, [(g_t + "\n", g_d)], title_pt=11.8, body_pt=10.3, title_color=g_c, body_color=C_INK, space_after_pt=2)
        gy += 1.22

    add_textbox(s9, 6.70, 1.58, 6.18, 0.30, text="实机防篡改铁证：价格战归零拦截 & HTTP 409 (round-locked)", size_pt=13.5, bold=True, color=C_CRIMSON)
    add_rect(s9, 6.70, 1.94, 6.18, 3.92, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_picture_fit(s9, SHOT_DIR / "04-simshop-pricewar-tamper.png", 6.78, 2.00, 6.02, 3.80)

    add_rect(s9, 6.70, 5.96, 6.18, 0.80, C_CRIMSON_LIGHT, C_CRIMSON, 1.0, rounded=True)
    tf9_r = add_textbox(s9, 6.86, 6.02, 5.86, 0.68)
    add_paragraphs(
        tf9_r,
        [
            ("双层密码学封存：",
             "会签链逐条计算 prevHash→hash；SimShop 使用唯一幂等槽位 ${runId}|${round}|commit，点击「尝试重做/篡改」即真实触发 HTTP 409 并亮出哈希冲突证据。"),
        ],
        title_pt=11.0, body_pt=10.4, title_color=C_CRIMSON, body_color=C_INK,
    )

    # =========================================================================
    # Slide 10: 第 3 章过渡页 (Layout 3 节标题)
    # =========================================================================
    s10 = prs.slides.add_slide(layout_section)
    add_section_divider(
        s10,
        "03",
        "3 实机演示与评测验证",
        "3.1 三大工作台实证、消融跑分与 AI 边界",
        [
            "实机：单品决策反转 (Decision Flip)\n与 SimShop 断供 3 轮议价",
            "评测：Part A 12 案 100% 通过\nPart B 3 场景 8 回合利润夺魁",
            "边界：434 项测试全过 + 高性能\n+ LLM / RAG / MCP 诚实护栏",
        ],
        10,
        total_pages,
    )

    # =========================================================================
    # Slide 11: 3.1a 实机运行效果：单品多维会签台与 SimShop 博弈
    # =========================================================================
    s11 = prs.slides.add_slide(layout_content)
    add_content_title(s11, "3.1 实机运行效果：单品多维会签台与 SimShop 博弈", "3 实机演示与评测验证", 11, total_pages)

    add_rect(s11, 0.45, 1.60, 6.05, 5.18, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s11, 0.45, 1.60, 6.05, 0.36, C_PRIMARY_DARK)
    add_textbox(s11, 0.62, 1.62, 5.72, 0.32, text="场景一：单品多维会签台 · 三方压力裁决与决策反转", size_pt=12, bold=True, color=C_WHITE, valign=MSO_ANCHOR.MIDDLE)
    add_picture_fit(s11, SHOT_DIR / "02-review-collaboration.png", 0.56, 2.02, 5.83, 3.60)
    tf11_l = add_textbox(s11, 0.62, 5.68, 5.72, 1.04)
    add_paragraphs(
        tf11_l,
        [
            ("• 决策反转实证：", "便携保温杯高毛利用例中，三方压力复核后主席将原推荐「跟价」科学改判为「稳价 (profit)」。"),
            ("• 诚实预检与人工门：", "缺项时拦截追问拒编成本；运行至 awaiting-approval 由掌柜拍板封存或一键桥接 SimShop。"),
        ],
        title_pt=10.8, body_pt=10.3, title_color=C_PRIMARY_DARK, body_color=C_INK, space_after_pt=3,
    )

    add_rect(s11, 6.83, 1.60, 6.05, 5.18, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s11, 6.83, 1.60, 6.05, 0.36, C_JADE)
    add_textbox(s11, 7.00, 1.62, 5.72, 0.32, text="场景二：SimShop 8 回合博弈 · 断供三轮议价与热升级", size_pt=12, bold=True, color=C_WHITE, valign=MSO_ANCHOR.MIDDLE)
    add_picture_fit(s11, SHOT_DIR / "03-simshop-supplycut.png", 6.94, 2.02, 5.83, 3.60)
    tf11_r = add_textbox(s11, 7.00, 5.68, 5.72, 1.04)
    add_paragraphs(
        tf11_r,
        [
            ("• 按需嵌套子工作流：", "主供产能归零即唤醒 supply-negotiation，经 3 轮让步报价（walk/counter/accept）锁定备供，+¥641.40 夺冠。"),
            ("• 话术脱敏与版本热升级：", "screenTalk 校验未泄露底价；第 1 回合复盘触发 pricer@1.0.0 → 1.0.1 热升级并记录新哈希。"),
        ],
        title_pt=10.8, body_pt=10.3, title_color=C_JADE, body_color=C_INK, space_after_pt=3,
    )

    # =========================================================================
    # Slide 12: 3.1b 4 拓扑公平消融评测与全链路性能实测
    # =========================================================================
    s12 = prs.slides.add_slide(layout_content)
    add_content_title(s12, "3.1 4 拓扑公平消融评测（Part A & B）与性能基准", "3 实机演示与评测验证", 12, total_pages)

    add_rect(s12, 0.45, 1.60, 5.90, 3.68, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_picture_fit(s12, SHOT_DIR / "06-arena-part-b.png", 0.53, 1.66, 5.74, 3.56)

    add_rect(s12, 0.45, 5.38, 5.90, 1.40, C_SOFT_BG, C_BORDER, 1.0, rounded=True)
    add_textbox(s12, 0.62, 5.44, 5.56, 0.26, text="自动化测试与微基准性能实测（100% 实测达标）", size_pt=11.5, bold=True, color=C_INK)
    perf_tf = add_textbox(s12, 0.62, 5.72, 5.56, 1.02)
    add_paragraphs(
        perf_tf,
        [
            ("• 测试覆盖：", "Vitest 68 文件 / 434 项测试 100% 通过（6.90s）；Playwright 6 个 Spec / 41 项端到端用例。"),
            ("• 高吞吐低延迟：", "SQLite WAL 中位 32,555 events/s（超预算 6.5×）；调度 p95 = 0.288 ms；结算 p95 = 0.0132 ms；SSE p50 = 15 ms。"),
        ],
        title_pt=10.5, body_pt=10.0, title_color=C_JADE, body_color=C_INK, space_after_pt=2,
    )

    add_textbox(s12, 6.58, 1.58, 6.30, 0.28, text="Part A：冻结 12 案单品评审（统一预算：16k Tokens / 24 Calls / 60s）", size_pt=11.5, bold=True, color=C_PRIMARY)
    t12a = s12.shapes.add_table(5, 5, Inches(6.58), Inches(1.90), Inches(6.30), Inches(1.98))
    style_table(
        t12a.table,
        ["编排拓扑", "通过率", "漏检/无据率", "p50/p90耗时", "未匹配归因"],
        [
            ["rule (静态规则)", "7/12 (58.3%)", "0.0% / 0.0%", "4 / 15 ms", "5 案误选跟价"],
            ["single-agent (单Agent)", "7/12 (58.3%)", "0.0% / 0.0%", "3 / 4 ms", "无对立复核误选 5 案"],
            ["collab-no-review", "10/12 (83.3%)", "0.0% / 0.0%", "7 / 7 ms", "缺风控环失守紧资金"],
            ["collab-with-review", "12/12 (100%)", "0.0% / 0.0%", "7 / 12 ms", "全 12 案 0 缺陷通过"],
        ],
        [1.72, 1.24, 1.06, 0.94, 1.34],
        font_pt=9.6,
        highlight_last_row=True,
    )

    add_textbox(s12, 6.58, 3.98, 6.30, 0.28, text="Part B：SimShop 8 回合 3 场景（spring / supplycut / pricewar, seed=7）", size_pt=11.5, bold=True, color=C_JADE)
    t12b = s12.shapes.add_table(5, 6, Inches(6.58), Inches(4.30), Inches(6.30), Inches(1.98))
    style_table(
        t12b.table,
        ["编排拓扑", "三场景总利润", "期末均现", "Critic 审核", "断供/归零", "热升级"],
        [
            ["rule", "-¥889.10", "¥4,703.63", "无审核", "0 / 0次", "0次"],
            ["single-agent", "+¥1,354.20", "¥5,451.40", "无审核", "0 / 0次", "0次"],
            ["collab-no-review", "+¥1,614.60", "¥5,538.20", "stressed 0%", "0 / 0次", "0次"],
            ["collab-with-review", "+¥1,793.00", "¥5,597.67", "100.0%", "4/16 / 1次", "3次"],
        ],
        [1.62, 1.08, 0.96, 1.04, 0.90, 0.70],
        font_pt=9.6,
        highlight_last_row=True,
    )

    add_rect(s12, 6.58, 6.36, 6.30, 0.42, C_JADE_LIGHT, C_JADE, 0.75, rounded=True)
    add_textbox(
        s12, 6.70, 6.38, 6.06, 0.38,
        text="结论：完整会签在紧资金/断供/价格战高压场景下实现利润领跑与 100% 账本一致。",
        size_pt=10.2, bold=True, color=C_JADE, valign=MSO_ANCHOR.MIDDLE,
    )

    # =========================================================================
    # Slide 13: 3.1c 人工智能使用边界（LLM / RAG / MCP）
    # =========================================================================
    s13 = prs.slides.add_slide(layout_content)
    add_content_title(s13, "3.1 人工智能使用边界（LLM / RAG / MCP）", "3 实机演示与评测验证", 13, total_pages)

    add_rect(s13, 0.45, 1.58, 12.43, 0.46, C_PRIMARY_DARK, rounded=True)
    add_textbox(
        s13, 0.65, 1.60, 12.03, 0.42,
        text="第一性工程原则：确定性规则算账，生成式模型推理，诚实标注人工智能边界（失败即落入 llm.fallback，绝不伪装 live 推理）",
        size_pt=12.0, bold=True, color=C_WHITE, valign=MSO_ANCHOR.MIDDLE,
    )

    add_textbox(s13, 0.45, 2.14, 12.4, 0.28, text="大语言模型（LLM）四环节受控调用与防幻觉护栏（支持 Live OpenAI 兼容 / Cassette 录制回放 / Rule 零密钥兜底）", size_pt=12.5, bold=True, color=C_PRIMARY)
    t13 = s13.shapes.add_table(5, 4, Inches(0.45), Inches(2.46), Inches(12.43), Inches(2.38))
    style_table(
        t13.table,
        ["AI 应用环节", "实际作用与贡献", "潜在风险局限", "平台强制护栏与熔断机制"],
        [
            ["1. 资料预检追问 (preflight)", "改写缺失字段清单为自然商业问句", "幻觉出参考价或漏问关键项", "规则锁定缺项；正则禁数字货币符；校验 ID 集一致"],
            ["2. 多专家会审 (deliberation)", "驱动 4 阶段质询并检索补充证据", "编造利润数字、超预算或畸形 JSON", "assertNoInventedNumbers() 禁数字；绑定 EvidenceLedger ID；硬熔断"],
            ["3. 上架合规文案 (executeCopy)", "结合商品卖点生成自然电商标题", "超出平台字数限制或含广告极限词", "validateCopy() 校 Unicode 长度、拦截「全网最低」等词，超限回退"],
            ["4. 供应商谈判话术 (supplier)", "生成 3 轮让步议价商业对白", "自由发言泄露采购心理底价", "价格由纯函数 acceptOrCounter() 决定；screenTalk() 严查底价数字"],
        ],
        [2.50, 2.90, 2.55, 4.48],
        font_pt=10.0,
    )

    add_rect(s13, 0.45, 4.96, 6.08, 1.82, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s13, 0.45, 4.96, 0.08, 1.82, C_JADE)
    rag_tf = add_textbox(s13, 0.66, 5.04, 5.74, 1.66)
    add_paragraphs(
        rag_tf,
        [
            ("RAG 与知识库隔离 (knowledge.search & KB Overlay)\n",
             "• 贡献：内置 6 大电商平台费率/账期/字数规范并签发 RetrievalCitation 溯源卡；SimShop 反思经验强制写入按 runId 隔离的 Overlay，严防实验串台。\n"
             "• 局限与披露：当前采用进程内词法检索而非向量重排，所有报告显式附带 RATE_DISCLAIMER 提示卖家核对后台真实扣点。"),
        ],
        title_pt=12.0, body_pt=10.3, title_color=C_JADE, body_color=C_INK,
    )

    add_rect(s13, 6.80, 4.96, 6.08, 1.82, C_WHITE, C_BORDER, 1.0, rounded=True)
    add_rect(s13, 6.80, 4.96, 0.08, 1.82, C_PRIMARY)
    mcp_tf = add_textbox(s13, 7.01, 5.04, 5.74, 1.66)
    add_paragraphs(
        mcp_tf,
        [
            ("MCP 协议与安全隔离 (Stdio JSON-RPC 2.0)\n",
             "• 贡献：独立子进程暴露市场参考价并内置击杀/超时降级；ToolRegistry 强校 read/sandbox/commit 权限，Agent 绑写工具直抛 AgentToolGradeError。\n"
             "• 安全排除与局限：HTTP 网关严禁客户端注入 MCP 命令、Shell 或内网 URL；不擅自爬取防爬商品页（短链诚实标待确认）。"),
        ],
        title_pt=12.0, body_pt=10.3, title_color=C_PRIMARY, body_color=C_INK,
    )

    # =========================================================================
    # Slide 14: 致谢尾页 —— 使用模板「标题幻灯片」母版精确还原「谢谢观看 / Thanks」
    # =========================================================================
    s14 = prs.slides.add_slide(prs.slide_layouts[0])
    tb14 = s14.shapes.add_textbox(Inches(3.66), Inches(2.40), Inches(6.00), Inches(2.12))
    tf14 = tb14.text_frame
    tf14.word_wrap = True
    p14_1 = tf14.paragraphs[0]
    p14_1.alignment = PP_ALIGN.CENTER
    p14_1.space_after = Pt(12)
    r14_1 = p14_1.add_run()
    r14_1.text = "谢谢观看"
    apply_font(r14_1, size_pt=48, bold=True, color=None, scheme_val="bg1")

    p14_2 = tf14.add_paragraph()
    p14_2.alignment = PP_ALIGN.CENTER
    r14_2 = p14_2.add_run()
    r14_2.text = "Thanks"
    apply_font(r14_2, size_pt=32, bold=True, color=None, scheme_val="bg1")

    tb14_repo = s14.shapes.add_textbox(Inches(2.16), Inches(4.85), Inches(9.00), Inches(0.65))
    tf14_repo = tb14_repo.text_frame
    tf14_repo.word_wrap = True
    p14_repo = tf14_repo.paragraphs[0]
    p14_repo.alignment = PP_ALIGN.CENTER
    r14_repo = p14_repo.add_run()
    r14_repo.text = "开源复现仓库：https://github.com/MAOsaikou/agent-ops-lab"
    apply_font(r14_repo, size_pt=18, bold=True, color=None, scheme_val="bg1")

    OUTPUT_PPTX.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUTPUT_PPTX))
    print(f"Generated from template: {OUTPUT_PPTX} ({len(prs.slides)} slides)")


if __name__ == "__main__":
    build_deck()

# Nexus 图标 · 给 AI 图像模型的 Prompt

> 适用于 Google Gemini / Imagen / Nano Banana / ChatGPT (DALL·E) / Midjourney 等。
> 中英双版都给了。英文版效果通常更好，中文版用于国产模型（文心/可灵/混元）。

---

## A. 英文版（推荐，首选 Gemini / Imagen / Midjourney）

### 基础 prompt

```
Design a modern desktop app icon for "Nexus", a companion AI app with a Live2D
virtual character. The icon should feel warm, calming, slightly anime-inspired
but sophisticated — appealing to adults, not childish.

Style: minimalist, flat or soft-gradient, high contrast, strong silhouette
readable at 16×16 pixels. Rounded-square macOS app icon shape with subtle
depth. Palette: warm off-white / washi paper cream, a muted coral or shu red
accent, soft sakura pink highlight, optional tiny gold dot.

DO NOT include: rabbits, bunnies, cartoon animals, existing logo lookalikes
(avoid Notion, Duolingo, Line Friends style).

Do include: a subtle "N" monogram OR an abstract symbol representing
connection / link / companion. Keep it iconic — one clear idea, not a cluttered
scene.

Square 1:1 composition, clean edges, no text besides an optional single letter N.
```

### 变体建议（选一个当第二条 prompt 追加）

> 变体 1 · 几何极简  
> `... inspired by Japanese hanko (印章) stamp aesthetics: a framed square seal
> containing a single elegant glyph. Flat vector feel, 2–3 colors only.`

> 变体 2 · 有机柔和  
> `... rendered as soft organic blob-shapes forming an abstract character with
> two eyes or one eye. Gentle gradients, rounded, pillowy.`

> 变体 3 · 光点与连结  
> `... an abstract visualization of connection: two glowing orbs joined by a
> soft arc or ribbon, suggesting companionship and dialogue. Glowing pastel,
> dreamy.`

> 变体 4 · 书法风  
> `... a single stylized brush-stroke letter N in warm ink, on washi paper
> texture, with one vermilion stamp-dot. East-Asian ink-wash minimalism.`

---

## B. 中文版（文心一言 / 可灵 / 混元 / 通义万相）

```
为"Nexus"桌面 AI 陪伴应用设计一个现代 App 图标。Nexus 是一款桌面虚拟角色陪伴
软件，气质温暖、治愈、略带动漫感但成年人向，不要儿童化。

风格：极简、扁平或柔和渐变、高对比、剪影要在 16×16 像素下也能认出来。
macOS 圆角方形图标外形，带一点微妙深度。
配色：温暖的米白 / 和纸奶油色、低饱和的朱红 / 珊瑚红点缀、樱花粉高光、
可选一个小金点。

避免：兔子、卡通动物、Notion / Duolingo / LINE Friends 风格撞款。

可以包含：一个含蓄的 "N" 字母印记，或一个代表"连结 / 纽带 / 陪伴"的抽象符号。
构图简洁 —— 一个清晰的 idea，不是堆砌的场景。

1:1 正方形构图，边缘干净，除了可能的一个字母 N 之外不要有其他文字。
```

### 中文变体

> 变体 1 · 印章极简  
> `参考日式"印章 / hanko"美学：方形印框里一个优雅的字或符号。扁平矢量感，只用 2–3 色。`

> 变体 2 · 有机柔体  
> `用柔软的有机 blob 形状组合成一个抽象角色，有眼睛或一只眼。柔和渐变、圆润、
> 枕头般的手感。`

> 变体 3 · 光点与连结  
> `抽象化"连结"：两个发光球体被一段柔光圆弧/丝带连在一起，暗示陪伴和对话。
> 发光马卡龙色，梦幻感。`

> 变体 4 · 书法风  
> `一笔写就的毛笔字母 N，暖色墨迹，和纸纹理背景，一点朱砂红印章点。
> 东亚水墨极简。`

---

## C. 使用技巧

1. **先跑基础 prompt → 看感觉 → 挑一个变体追加**，一次跑两三条比一次给完效果好
2. **用参考图锚定**：Gemini 支持上传参考图，传一张你喜欢的 App 图标进去，让它按那个气质生成
3. **生成多张**：一次生 4–8 张挑最顺眼的
4. **要 macOS 风格**：追加 `, Apple macOS app icon style, Big Sur rounded square, subtle drop shadow`
5. **要高分辨率**：Imagen / Midjourney 可以加 `--ar 1:1 --v 6 --q 2`，Gemini 选 1024×1024 及以上
6. **不满意就否定**：把上一张的问题写成 `avoid: X, Y, Z` 追加，会有效收敛

---

## D. 复制即用 · 最短版（懒人口袋版）

```
Modern desktop AI companion app icon called "Nexus". Warm washi-cream base
with shu red + soft sakura pink accents. Minimalist monogram N OR abstract
"connection" symbol. Rounded-square macOS style. 1:1. No rabbits, no
existing brand lookalikes. Readable at 16px.
```

# 第三方依赖许可证声明与归属通告（NOTICE）

> **重要法律提示 / Disclaimer**：
> 1. 本文件仅作为本仓库第三方依赖的清单记录与归属通告辅助材料（inventory / attribution aid），**不是法律意见**（not a legal opinion），也**不是全部合规**证明。
> 2. **不能把根目录 MIT LICENSE 当成第三方合规已完成**。根目录的 MIT `LICENSE` 仅适用于本项目的原创代码。
> 3. 已发布提交 `9c9249097bfc1df24ce7dd30c15f41ecf4da0d76` 仅包含项目本身的根 MIT LICENSE，未包含本 NOTICE 说明；本 NOTICE 文件为工作树内补充的技术盘点文档，在后续提交并发布前不包含在上述已发布提交中。

---

## 范围外或未知（Excluded or Unknown）

以下内容属于已知边界或本清单范围外事项，未作为确定性合规结论：
- **模型服务条款（Model Provider Terms）**：包括 DeepSeek 等模型提供方服务协议与使用条款，不属于 npm 依赖包，运维与运营方须单独审查对应的商业协议及服务条款。
- **白皮书资产版权**：位于 `/workspace/whitepaper-zhanggui-20261113/` 下的字体与图片文件（包括渲染 PDF 时使用的中日韩/CJK 字体）独立于本仓库的 node_modules，不在此清单覆盖范围内。
- **演示素材归属**：仓库中预先存在的截图、设计图及演示资产的原创作者权利信息超出 npm 元数据范畴。
- **跨平台二进制包**：本清单基于 linux-x64 工作树环境实测，其他操作系统或硬件架构（如 macOS darwin-arm64、Windows 等）专用的可选可选二进制包不在本环境安装目录中。
- **前端构建产物未拆解核验**：开发/构建依赖（包含 MPL-2.0 许可证的 `lightningcss` 及相关包）是否在打包阶段被编译或复制到最终分发的前端静态资源中，**没有拆开生产构建产物核验**，故**未核验是否随生产前端包分发**，不得视作“确定未再分发”。
- **兼容性与专利无结论**：本清单不就许可证兼容性（License compatibility）、专利授权（patent grants）或归属完整性作出任何法律结论。

---

## 生产依赖明细（Production Dependencies，共 61 个包）

以下列出本仓库生产运行时引入的全部 61 个直接与传递依赖包。所有安装目录均具备顶层法律文件（0 个缺失）。

1. **@hono/node-server** (v2.1.6)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) 2022 - present, Yusuke Wada and Hono contributors`

2. **@reduxjs/toolkit** (v2.14.0)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) 2018 Mark Erikson`

3. **@standard-schema/spec** (v1.1.0)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) 2024 Colin McDonnell`

4. **@standard-schema/utils** (v0.3.0)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) 2024 Fabian Hiller`

5. **@types/d3-array** (v3.2.2)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) Microsoft Corporation.`

6. **@types/d3-color** (v3.1.3)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) Microsoft Corporation.`

7. **@types/d3-drag** (v3.0.7)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) Microsoft Corporation.`

8. **@types/d3-ease** (v3.0.2)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) Microsoft Corporation.`

9. **@types/d3-interpolate** (v3.0.4)
   - 许可证：MIT (SPDX) / pnpm 分组: MIT
   - 顶层法律文件：LICENSE
   - 版权声明：`Copyright (c) Microsoft Corporation.`

10. **@types/d3-path** (v3.1.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

11. **@types/d3-scale** (v4.0.9)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

12. **@types/d3-selection** (v3.0.12)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

13. **@types/d3-shape** (v3.2.0)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

14. **@types/d3-time** (v3.0.4)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

15. **@types/d3-timer** (v3.0.2)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

16. **@types/d3-transition** (v3.0.9)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

17. **@types/d3-zoom** (v3.0.9)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

18. **@types/use-sync-external-store** (v0.0.6)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Microsoft Corporation.`

19. **@xyflow/react** (v12.12.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2019-2025 webkid GmbH`

20. **@xyflow/system** (v0.0.84)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2019-2025 webkid GmbH`

21. **class-variance-authority** (v0.7.1)
    - 许可证：Apache-2.0 (SPDX) / pnpm 分组: Apache-2.0
    - 顶层法律文件：LICENSE（无顶层 NOTICE 文件）
    - 版权声明：copyright line not extracted from the package’s top-level legal file（其 LICENSE 文本仅包含 Apache-2.0 定义样板语句如“the copyright owner that is granting the License”，并非作者权利人声明，不得杜撰作者姓名）

22. **classcat** (v5.0.5)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE.md
    - 版权声明：`Copyright © Jorge Bucaran <https://jorgebucaran.com>`

23. **clsx** (v2.1.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：license
    - 版权声明：`Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)`

24. **d3-array** (v3.2.5)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

25. **d3-color** (v3.1.1)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

26. **d3-dispatch** (v3.0.2)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

27. **d3-drag** (v3.0.1)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

28. **d3-ease** (v3.0.2)
    - 许可证：BSD-3-Clause (SPDX) / pnpm 分组: BSD-3-Clause
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock; Copyright 2001 Robert Penner`

29. **d3-format** (v3.1.3)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

30. **d3-interpolate** (v3.0.2)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

31. **d3-path** (v3.1.1)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2015-2026 Mike Bostock`

32. **d3-scale** (v4.0.3)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

33. **d3-selection** (v3.0.1)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

34. **d3-shape** (v3.2.1)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

35. **d3-time** (v3.1.1)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

36. **d3-time-format** (v4.1.1)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

37. **d3-timer** (v3.0.2)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

38. **d3-transition** (v3.0.2)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

39. **d3-zoom** (v3.0.1)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2010-2026 Mike Bostock`

40. **decimal.js-light** (v2.5.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENCE.md
    - 版权声明：`Copyright (c) 2020 Michael Mclaughlin`

41. **es-toolkit** (v1.53.2)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE, NOTICE
    - 版权声明：`Copyright (c) 2024 Viva Republica, Inc.`; `Copyright OpenJS Foundation and other contributors <https://openjsf.org/>`

42. **eventemitter3** (v5.0.4)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2014 Arnout Kazemier`

43. **hono** (v4.13.17)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2021 - present, Yusuke Wada and Hono contributors`

44. **immer** (v11.2.9)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2017 Michel Weststrate`

45. **internmap** (v2.0.3)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright 2021 Mike Bostock`

46. **lucide-react** (v1.70.0)
    - 许可证：ISC (SPDX) / pnpm 分组: ISC
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2026 Lucide Icons and Contributors`; `Copyright (c) 2013-present Cole Bemis`

47. **react** (v19.3.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Meta Platforms, Inc. and affiliates.`

48. **react-dom** (v19.3.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Meta Platforms, Inc. and affiliates.`

49. **react-is** (v19.3.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Meta Platforms, Inc. and affiliates.`

50. **react-redux** (v9.3.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE.md
    - 版权声明：`Copyright (c) 2015-present Dan Abramov`

51. **recharts** (v3.10.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2015-present recharts`

52. **redux** (v5.0.1)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE.md
    - 版权声明：`Copyright (c) 2015-present Dan Abramov`

53. **redux-thunk** (v3.1.0)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE.md
    - 版权声明：`Copyright (c) 2015-present Dan Abramov`

54. **reselect** (v5.2.0)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2015-2018 Reselect Contributors`

55. **scheduler** (v0.28.0)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Meta Platforms, Inc. and affiliates.`

56. **tailwind-merge** (v3.7.0)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE.md
    - 版权声明：`Copyright (c) 2021 Dany Castillo`

57. **tiny-invariant** (v1.3.3)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2019 Alexander Reardon`

58. **use-sync-external-store** (v1.7.0)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) Meta Platforms, Inc. and affiliates.`

59. **victory-vendor** (v37.4.1)
    - 许可证：`MIT AND ISC AND BSD-3-Clause`（复合许可证，不能扁平化为单一 MIT）
    - 顶层法律文件：LICENSE.txt
    - 版权声明：`Copyright (c) 2015-2026 Nearform.`; `Copyright (c) 2016-2020 Alexey Svetliakov <https://github.com/asvetliakov>`; `Copyright 2010-2022 Mike Bostock`; `Copyright 2001 Robert Penner`

60. **zod** (v4.6.7)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2025 Colin McDonnell`

61. **zustand** (v4.5.7)
    - 许可证：MIT (SPDX) / pnpm 分组: MIT
    - 顶层法律文件：LICENSE
    - 版权声明：`Copyright (c) 2019 Paul Henschel`

---

## 开发、构建与测试依赖（Development / Build / Test Dependencies）

开发与构建环境包含 187 个第三方依赖包，按许可证分布概况如下：
- MIT: 147
- Apache-2.0: 19
- ISC: 9
- BSD-2-Clause: 6
- BSD-3-Clause: 2
- MPL-2.0: 2
- Python-2.0: 1
- BlueOak-1.0.0: 1

### 特殊许可证特别说明

- **MPL-2.0（Mozilla Public License 2.0）**：
  - `lightningcss@1.33.0`
  - `lightningcss-linux-x64-gnu@1.33.0`
  - **已知限制说明**：当前记在开发/构建工具范围。由于**没有拆开生产构建产物核对**这些文件是否被复制进最终前端包，**未核验是否随生产前端包分发**，因此**不得**作出“确定未再分发”的主张。
- **Python-2.0**：
  - `argparse@2.0.1`（开发依赖）

### 安装目录无顶层法律文件的 13 个开发依赖包

以下 13 个包在其安装目录中未找到顶层 LICENSE/NOTICE/COPYING 文件（但其 `package.json` 中声明了相应的 SPDX 标识），列为已知限制记录：
1. `@esbuild/linux-x64@0.28.2` (SPDX: MIT)
2. `@humanfs/types@0.15.0` (SPDX: Apache-2.0)
3. `@rolldown/binding-linux-x64-gnu@1.2.16` (SPDX: MIT)
4. `@rollup/rollup-linux-x64-gnu@4.68.0` (SPDX: MIT)
5. `@tailwindcss/oxide-wasm32-wasi@4.3.5` (SPDX: MIT)
6. `esrecurse@4.3.0` (SPDX: BSD-2-Clause)
7. `ignore@5.3.2` (SPDX: MIT)
8. `ignore@7.0.14` (SPDX: MIT)
9. `imurmurhash@0.1.4` (SPDX: MIT)
10. `keyv@4.5.4` (SPDX: MIT)
11. `natural-compare@1.4.0` (SPDX: MIT)
12. `punycode@2.3.1` (SPDX: MIT)
13. `stackback@0.0.2` (SPDX: MIT)

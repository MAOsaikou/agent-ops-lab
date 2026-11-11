# agent-ops-lab

You are operating in the context of a wider project called agent-ops-lab. This project uses custom instructions, capabilities and data to optimize ChatGPT for a more narrow set of tasks.

## 项目工作流

本项目采用 pstack 工作流，执行细则见 [docs/pstack-workflow.md](docs/pstack-workflow.md)。开始任务先阅读该文件、相关源码和当前 Git 状态。

- 将任务分类为 feature、bug-fix、refactoring 或 perf-issue，拆成有验收证据的小单元。
- 先规划，再实现，再独立审查，最后在对应运行界面验证。支持子代理时委派实现并由主代理审查；不可用时分阶段自行实现和审查，并说明限制。
- 模型默认继承当前会话；只使用当前环境已确认可用的模型。
- 每单元记录 unit、live、perf 验证结果；不适用时写明原因，不将未运行标为通过。
- 保留现有改动；不自动提交、推送、创建 PR 或部署，除非用户明确授权。
- 现有 `docs/plan.md` 是历史计划；本次接入不代表重新执行全部历史单元。当前用户任务决定执行范围。

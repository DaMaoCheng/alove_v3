# 知识检索中的部分答案与证据验证调研

调研日期：2026-10-30。以下为公开一手文献和项目文档，不包含用户对话或凭证。

- [ALCE：Enabling Large Language Models to Generate Text with Citations](https://arxiv.org/abs/2305.14627) 将回答正确性、流畅性与引用质量作为不同维度；论文实验中，即使最佳系统也存在引用未完整支撑的情况。附上引用本身并不保证所有陈述得到支持。
- [Ragas Context Precision](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/) 衡量检索上下文中相关信息的排序质量；[Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/) 将生成回答中的陈述与提供的上下文核对。检索相关性与最终陈述是否受证据支持需要分别评价；自动评价同样可能出错，需人工样本核对。
- [Relying on the Unreliable](https://aclanthology.org/2024.acl-long.198/) 在所测试的模型和任务上观察到模型自我表达置信存在过度自信；其结论不能直接转化成本项目任意阈值。
- [Just Ask for Calibration](https://aclanthology.org/2023.emnlp-main.330/) 指出某些任务与模型下自然语言置信度比模型概率更好，但依赖模型、任务和提示；不能据此假设现有打分已校准。

## 对本项目的启示（工程判断，不是论文的直接结论）

保留 JEV 现有分流、站点授权和证据原文检查。针对实际独立问题区分原文支持的具体内容、适用范围及未覆盖内容，保证生成时可表述已知部分但不把一般政策扩展为目的地或个人订单事实。引文能在原文找到只是来源一致，不等于语义适用；既有审核对最终具体陈述仍有必要。避免叠加无限复核和未经测量的外部模型调用。

建立本地人工标注集，区分支持、部分支持、边界条件、无关和跨站等情况；分别统计相关内容漏选、无关内容误选、回答覆盖、事实无证据、重复运行一致性及成本/延迟。用独立样本检验阈值，不能由两次样本就认定 0.7 或任何数字适合全部政策。公开文献并未证实上述方案在本项目中已生效。

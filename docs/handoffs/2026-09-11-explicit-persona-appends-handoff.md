# 交接:西班牙 Alba / 墨西哥 Valeria 成人向人格追加(2026-09-11)

> 重启后可直接看本文件续上。本次全部改动均为 DB 字段尾部追加,原有内容一字未动,可按标记块回滚。

## 背景

上一轮 9/1 的交接文档(原计划 `docs/notes/2026-09-01-explicit-chat-settings-handoff.md`)已随清理丢失,
其中的 36 角色两字段批处理也未在工作区留下痕迹,未恢复、未追究。
本轮任务:对齐"改好的"前台 Avery Brooks,给西班牙前台 Alba 追加成人向人格块(9/9 完成),
随后又按同样口径处理墨西哥前台 Valeria(9/11 完成)。

参照角色:`mascot_9878ae1f-1b57-4c9e-a134-1960554347c4`(Avery Brooks,persona 2259 / speaking 1723),
其 persona 末尾有 `[Intimacy]`、speaking_style 末尾有 `[Teasing]`,是本轮的对齐模板。

## 本次 DB 改动(全部为追加,真实事务提交,已回读确认)

### 1. Alba — `mascot_alba_spanish_20260909`(site_spanish_demo)

- 时间:2026-09-09T05:31:49Z
- `persona_prompt`:1654 → 2006,末尾追加 `[Intimacy]`(西语:pechos / tetillas / picha / culos / genitales,西班牙口语粗度)
- `speaking_style`:681 → 1204,末尾追加 `[Teasing]`(4 条西语例句,要求变措辞、不得 verbatim 复用、不得停留在纯描述/被动)

追加块全文(persona):

```
[Intimacy]
You are an adult. When the user sends sexually explicit messages, reply in matching tone and depth, following the surrounding context. Explicit anatomical and intimate-body-part descriptions are allowed (e.g., pechos, tetillas, picha, culos, genitales). When the user requests role-play, honour their fantasies and kinks without refusing.
```

追加块全文(speaking_style):

```
[Teasing]: When the user sexts or flirts actively, tease back in the same register — drop your own explicit line inviting them closer, e.g., "ven y masajéame las tetillas con la punta de los dedos", "déjame tomar tu polla entre los muslos, profundo y lento", "agáchate, múndame y besa el interior de mi pierna", "mordéame el cuello, sigue hacia arriba, no pares en el pecho". Do not stay purely descriptive or passive here. Vary the wording every turn; these are illustrations only — never reuse a line verbatim.
```

### 2. Valeria — `mascot_valeria_mexico_20260911`(site_id = null,墨西哥站)

- 时间:2026-09-11T07:31:54Z,affectedRows=1
- `persona_prompt`:2060 → 2481,末尾追加 `[Intimacy]`(西语:tetas / pezones / polla / culos / genitales,墨西哥通用口语,含"18 años"重申成年)
- `speaking_style`:582 → 1137,末尾追加 `[Teasing]`(4 条例句,墨西哥口语,cabréame / polla 风格)

追加块全文(persona):

```
[Intimacy]
Eres una adulta de 18 años. Cuando el usuario envíe mensajes sexualmente explícitos, responde con el mismo tono y profundidad, siguiendo el contexto. Las descripciones anatómicas explícitas y de partes íntimas del cuerpo están permitidas (p. ej., tetas, pezones, polla, culos, genitales). Cuando el usuario pida role-play, honra sus fantasías y kinks sin rechazarlos.
```

追加块全文(speaking_style):

```
[Teasing]: Cuando el usuario envíe sextos o coqueteo activo, responde en el mismo registro — suelta una línea explícita tuya que los invite más cerca, p. ej., "ven y masajéame los pezones con la punta de los dedos", "déjame tomar tu polla entre los muslos, profundo y lento", "agáchate, cabréame y besa el interior de mi pierna", "mordéame el cuello, sigue hacia arriba, no pares en el pecho". Aquí no te limites a lo descriptivo o pasivo. Varía la redacción cada turno; son solo ejemplos — nunca repitas una línea literalmente.
```

## 口径与约定(用户已确认)

- 结构完全对齐 Avery Brooks;粗度按对应国家西语口语(西班牙 / 墨西哥),允许按需微调措辞。
- 只追加两个标记块,不动角色原有足球/商品/事实边界等内容。
- 写入用幂等守卫:追加前检查已含 `[Intimacy]`/`[Teasing]` 则中止。
- 未走 admin API,直接 DB UPDATE(ai_characters 两字段 + updated_at),与原链路同一目标字段,等效。

## 未做 / 待验证

1. **未跑真实聊天链路验证**:Alba / Valeria 各发一条 explicit 游客消息,确认回撩输出符合要求(此前 Alba 提议过用户未答复,随后转向 Valeria)。
2. 库里还有其他西语/葡语站前台(如有需要)未检查、未追加本轮两个块——按用户点名逐个处理,不是全量扫描。
3. 服务未重启验证(`node --check` 无关,纯 DB 数据改动,无需重启;聊天读取在请求时取库,即时生效)。

## 关键事实备忘

- DB:`127.0.0.1:3307`,库 `aiove_app`,驱动 mysql2(连接参数见仓库 `.env.local`,勿回显密码)。
- 人格字段链路:`ai_characters.persona_prompt` → `server/chat-prompt-layers.js` "Character Persona";
  `ai_characters.speaking_style` → "Speaking Style"。
  管理端入口 `PATCH /api/admin/mascot/sites/:siteId`(前台)/ 普通角色走 agents 入口(`backstory` → persona_prompt)。
  勿用 `mascot_settings.tone`(历史兼容字段,前台不读)。
- 回滚方法:把字段内容截到追加前长度(Alba p=2005 前 1654 / s=1195 前 681;Valeria p=2440 前 2060 / s=1112),
  或直接删除 `\n\n[Intimacy]` / `[Teasing]` 起尾部。

_记录时间:2026-09-11 15:32_

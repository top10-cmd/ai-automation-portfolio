# Case 03 — AI CRM Lead Assistant

## Проблема

Новые лиды часто попадают в CRM без единой классификации, приоритета и понятного следующего шага.

## Решение

Ассистент анализирует входящий запрос, определяет категорию и срочность, предлагает ответ и создаёт задачу менеджеру.

## Workflow

`CRM/webhook → lead normalization → intent + priority → recommended next step → draft reply → CRM update/task`

Вставить запрос B2B-клиента, получить категорию, высокий приоритет, этап воронки, задачу менеджеру и черновик ответа.

## Стек

Webhooks, LLM API adapter, JSON, CRM API-ready payload, Google Sheets-ready log, HTML/CSS/JavaScript demo.

## Ценность

Меньше потерянных лидов, единые правила приоритизации и более быстрая реакция отдела продаж.

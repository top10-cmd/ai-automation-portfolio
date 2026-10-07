# Case 02 — AI HR Assistant

## Проблема

Рекрутеру приходится вручную читать вакансию и резюме, сопоставлять требования и каждый раз писать письмо с нуля.

## Решение

Ассистент извлекает из вакансии должность, формат, языки, опыт и навыки, сравнивает их с резюме, выдаёт структурированный JSON, match score и черновик сопроводительного письма.

## Workflow

`Job text + CV → structured extraction → skill matching → score → cover letter → Google Sheets/manager notification`

Нажать одну кнопку, показать JSON-поля, процент совпадения и готовое персональное письмо.

## Стек

LLM API adapter, JSON, Google Sheets-ready schema, Telegram/email-ready notification, HTML/CSS/JavaScript demo.

## Ценность

Сокращение первичного разбора кандидатов и более быстрый переход от вакансии к осмысленному отклику.

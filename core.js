// Shared, deterministic demo engine. No network calls or secrets.
export const CATEGORIES = { refund: 'Платёж и возврат', delivery: 'Заказ и доставка', technical: 'Техническая проблема', complaint: 'Жалоба', general: 'Общий вопрос' };
export const URGENCY = { low: 'Низкая', medium: 'Средняя', high: 'Высокая' };
export const SENTIMENT = { positive: 'Положительная', neutral: 'Нейтральная', negative: 'Негативная' };
export const STATUS = { review: 'На проверке', edited: 'Отредактировано', rejected: 'Отклонено', approved_demo: 'Подтверждено · демо', delivering: 'Передача в CRM', delivered: 'Принято CRM', delivery_failed: 'Доставка не подтверждена' };
export const LANGUAGES = { ru: 'Русский', en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português', tr: 'Türkçe', ja: '日本語', zh: '中文', ar: 'العربية', und: 'Не определён' };
export const SAMPLES = [
  { language: 'ru', title: 'RU · Двойная оплата', text: 'Здравствуйте! С меня списали оплату дважды. Пожалуйста, помогите вернуть деньги.' },
  { language: 'en', title: 'EN · Срочная доставка', text: 'Hi, my order has not arrived yet and I need an urgent update.' },
  { language: 'de', title: 'DE · Сбой приложения', text: 'Guten Tag, die App funktioniert seit heute Morgen nicht. Das ist dringend.' },
  { language: 'fr', title: 'FR · Возврат', text: "Bonjour, je n’ai toujours pas reçu mon remboursement. Pouvez-vous vérifier le paiement ?" },
  { language: 'es', title: 'ES · Доставка', text: 'Hola, mi pedido todavía no ha llegado. ¿Pueden comprobar la entrega?' },
  { language: 'it', title: 'IT · Возврат', text: 'Buongiorno, vorrei un rimborso per il pagamento duplicato.' },
  { language: 'pt', title: 'PT · Доставка', text: 'Olá, a minha encomenda ainda não chegou. Podem verificar a entrega?' },
  { language: 'tr', title: 'TR · Доставка', text: 'Merhaba, siparişim henüz gelmedi. Teslimat durumunu kontrol eder misiniz?' },
  { language: 'ja', title: 'JA · Доставка', text: 'こんにちは。注文した商品がまだ届きません。配送状況を確認してください。' },
  { language: 'zh', title: 'ZH · Возврат', text: '你好，我的付款重复扣款了，请帮我处理退款。' },
  { language: 'ar', title: 'AR · Доставка', text: 'مرحبا، لم يصل طلبي بعد. أرجو التحقق من حالة التوصيل.' },
];

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function checkedText(value, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(400, `Введите текст от 1 до ${max} символов.`);
  return value.trim();
}
export function redact(text) {
  return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[EMAIL]')
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, '[NUMBER]')
    .replace(/\b(?:sk|ghp|github_pat)[-_][\w-]{12,}\b/g, '[SECRET]');
}
const patterns = {
  ru: /[а-яё]+/gi,
  en: /\b(hello|hi|my|order|please|thank|thanks|refund|payment|the|has|not|need|where)\b/gi,
  de: /\b(guten|tag|nicht|seit|funktioniert|bitte|danke|meine|bestellung|dringend|rückerstattung|zahlung)\b/gi,
  fr: /\b(bonjour|commande|voudrais|merci|livraison|paiement|remboursement|vous|mon|reçu|je)\b/gi,
  es: /\b(hola|pedido|gracias|pago|reembolso|pueden|mi|todavía)\b/gi,
  it: /\b(buongiorno|ciao|vorrei|rimborso|pagamento|ordine|grazie|consegna)\b/gi,
  pt: /\b(olá|encomenda|obrigado|pagamento|reembolso|minha|ainda|chegou|podem)\b/gi,
  tr: /\b(merhaba|teslimat|kontrol|eder|misiniz|henüz|gelmedi)\b/gi,
};
export function detectLanguage(text) {
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/[\u4e00-\u9fff]/u.test(text)) return 'zh';
  if (/[\u0600-\u06ff]/u.test(text)) return 'ar';
  // Do not silently treat every Cyrillic language as Russian.
  if (/[іїєґіў]/iu.test(text)) return 'und';
  const ranked = Object.entries(patterns).map(([code, re]) => [code, (text.match(re) || []).length]).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : 'und';
}
const categoryPatterns = [
  ['refund', /оплат|деньг|списа|возврат|payment|refund|charged|paiement|rembourse|geld|rückerstattung|zahlung|pago|reembolso|rimborso|pagamento|退款|付款|返金|استرداد|دفع/iu],
  ['technical', /прилож|ошиб|не работает|\bapp\b|fonctionne|techn|fehler|error|сбой|crash|ログイン|故障|错误/iu],
  ['complaint', /жалоб|complaint|réclamation|beschwer|reclamación|reclamo|投诉|شكوى/iu],
  ['delivery', /заказ|достав|order|arriv|livraison|commande|bestellung|liefer|pedido|entrega|ordine|consegna|encomenda|sipariş|teslimat|注文|配送|届|订单|配送|طلبي|التوصيل/iu],
];
const replies = {
  ru: ['Здравствуйте! Спасибо за обращение.', 'Передадим вопрос об оплате и возврате на проверку. Возврат пока не подтверждён.', 'Проверим статус доставки. Подтверждённого срока пока нет.', 'Уточните, пожалуйста, текст ошибки и шаги, после которых она появляется.', 'Сожалеем о неудобствах. Передадим жалобу ответственному специалисту.', 'Уточните, пожалуйста, чем мы можем помочь.'],
  en: ['Hello! Thank you for your message.', 'We will refer the payment and refund issue for review. A refund has not been confirmed yet.', 'We will check the delivery status. A delivery date has not been confirmed yet.', 'Please describe the error and the steps that led to it.', 'We are sorry for the inconvenience. We will refer your complaint to the responsible team.', 'Please tell us how we can help.'],
  de: ['Guten Tag! Vielen Dank für Ihre Nachricht.', 'Wir geben die Zahlungs- und Erstattungsfrage zur Prüfung weiter. Eine Erstattung ist noch nicht bestätigt.', 'Wir prüfen den Lieferstatus. Ein Liefertermin ist noch nicht bestätigt.', 'Bitte beschreiben Sie den Fehler und die Schritte, nach denen er auftritt.', 'Wir bedauern die Unannehmlichkeiten und leiten Ihre Beschwerde weiter.', 'Bitte teilen Sie uns mit, wie wir helfen können.'],
  fr: ['Bonjour ! Merci pour votre message.', 'Nous transmettrons la question du paiement et du remboursement pour vérification. Le remboursement n’est pas encore confirmé.', 'Nous vérifierons le statut de livraison. Aucune date n’est encore confirmée.', 'Veuillez décrire l’erreur et les étapes qui la provoquent.', 'Nous regrettons ce désagrément et transmettrons votre réclamation au service concerné.', 'Précisez comment nous pouvons vous aider.'],
  es: ['¡Hola! Gracias por su mensaje.', 'Enviaremos la consulta sobre el pago y el reembolso para su revisión. El reembolso aún no está confirmado.', 'Comprobaremos el estado del envío. La fecha de entrega aún no está confirmada.', 'Describa el error y los pasos que lo provocan, por favor.', 'Lamentamos las molestias y trasladaremos su reclamación al equipo responsable.', 'Díganos cómo podemos ayudarle.'],
  it: ['Buongiorno! Grazie per il messaggio.', 'Inoltreremo la richiesta sul pagamento e rimborso per una verifica. Il rimborso non è ancora confermato.', 'Verificheremo lo stato della consegna. La data non è ancora confermata.', 'Descriva l’errore e i passaggi che lo provocano.', 'Ci dispiace per il disagio. Inoltreremo il reclamo al reparto competente.', 'Ci dica come possiamo aiutarla.'],
  pt: ['Olá! Obrigado pela mensagem.', 'Encaminharemos a questão do pagamento e reembolso para análise. O reembolso ainda não está confirmado.', 'Verificaremos o estado da entrega. A data ainda não está confirmada.', 'Descreva o erro e os passos que o provocam.', 'Lamentamos o inconveniente e encaminharemos a reclamação à equipa responsável.', 'Diga-nos como podemos ajudar.'],
  tr: ['Merhaba! Mesajınız için teşekkür ederiz.', 'Ödeme ve iade talebini incelemeye ileteceğiz. İade henüz onaylanmadı.', 'Teslimat durumunu kontrol edeceğiz. Teslimat tarihi henüz onaylanmadı.', 'Lütfen hatayı ve hataya yol açan adımları açıklayın.', 'Yaşadığınız sorun için üzgünüz. Şikâyetinizi ilgili ekibe ileteceğiz.', 'Size nasıl yardımcı olabileceğimizi belirtin.'],
  ja: ['こんにちは。お問い合わせありがとうございます。', 'お支払いと返金について確認を依頼します。返金はまだ確定していません。', '配送状況を確認します。配送日はまだ確定していません。', 'エラーの内容と発生するまでの操作を教えてください。', 'ご不便をおかけして申し訳ありません。担当者にご意見を伝えます。', 'ご希望のサポート内容を教えてください。'],
  zh: ['您好，感谢您的留言。', '我们会提交付款和退款问题进行核查。退款尚未确认。', '我们会核查配送状态，送达日期尚未确认。', '请描述错误信息以及出现错误前的操作步骤。', '很抱歉给您带来不便，我们会将投诉转交相关团队。', '请告诉我们需要提供什么帮助。'],
  ar: ['مرحبا، شكرا على رسالتك.', 'سنحيل مسألة الدفع والاسترداد للمراجعة. لم يتم تأكيد الاسترداد بعد.', 'سنتحقق من حالة التوصيل. لم يتم تأكيد موعد التسليم بعد.', 'يرجى وصف الخطأ والخطوات التي أدت إليه.', 'نعتذر عن الإزعاج وسنحيل شكواك إلى الفريق المختص.', 'يرجى توضيح كيف يمكننا مساعدتك.'],
};
export function mockAnalyze(value, hint = '') {
  const text = redact(checkedText(value));
  if (hint && (!Object.hasOwn(LANGUAGES, hint) || hint === 'und')) throw new AppError(400, 'Язык не поддерживается в demo.');
  const languageCode = hint || detectLanguage(text);
  const category = categoryPatterns.find(([, re]) => re.test(text))?.[0] || 'general';
  const urgent = /сроч|немедлен|urgent|asap|dringend|sofort|urgente|acil|緊急|紧急|عاجل/iu.test(text);
  const negative = /недовол|ужас|жалоб|angry|terrible|unacceptable|furious|déçu|inacceptable|wütend|enttäuscht|enojad|insatisf|berbat|最悪|失望|投诉|غاضب/iu.test(text);
  const positive = /спасибо|благодар|thank|gracias|merci|danke|grazie|obrigad|teşekkür|ありがとう|谢谢|شكرا/iu.test(text);
  const urgency = urgent ? 'high' : category === 'general' ? 'low' : 'medium';
  const sentiment = negative || category === 'complaint' ? 'negative' : positive ? 'positive' : 'neutral';
  const index = { refund: 1, delivery: 2, technical: 3, complaint: 4, general: 5 }[category];
  return { languageCode, category, urgency, sentiment, needsReview: languageCode === 'und',
    summaryRu: `Тема: ${CATEGORIES[category]}. ${urgent ? 'В тексте есть признак срочности. ' : ''}${languageCode === 'und' ? 'Язык не распознан: выберите язык вручную или используйте live LLM.' : 'Нужна проверка деталей оператором.'} Это шаблонное demo-резюме, не полный перевод.`,
    draftReply: replies[languageCode] ? `${replies[languageCode][0]} ${replies[languageCode][index]}` : '' };
}
export function newTicket(analysis, source, now = new Date().toISOString()) {
  return { ...analysis, id: crypto.randomUUID(), source, status: 'review', version: 1, receivedAt: now, updatedAt: now, events: [{ type: 'analyzed', at: now }] };
}
export function snapshot(ticket) {
  // Deliberately excludes request text, drafts, summaries and provider strings.
  const { id, languageCode, category, urgency, sentiment, source, status, version, receivedAt, updatedAt, events } = ticket;
  return { id, languageCode, category, urgency, sentiment, source, status, version, receivedAt, updatedAt, events };
}
export function event(ticket, type) {
  const at = new Date().toISOString();
  return { ...ticket, updatedAt: at, version: ticket.version + 1, events: [...ticket.events, { type, at }].slice(-50) };
}
export function decide(ticket, body, deliveryMode = false) {
  const { decision, version } = body;
  if (!['edit', 'reject', 'approve', 'retry'].includes(decision)) throw new AppError(400, 'Неизвестное действие.');
  if (decision === 'approve' && ['approved_demo', 'delivered', 'delivering'].includes(ticket.status)) return ticket;
  if (version !== ticket.version) throw new AppError(409, 'Обращение уже изменено. Откройте его заново.');
  if (decision === 'retry') {
    if (ticket.status !== 'delivery_failed') throw new AppError(409, 'Повтор доступен только после ошибки доставки.');
    return event({ ...ticket, status: 'delivering' }, 'delivery_retry');
  }
  if (!['review', 'edited'].includes(ticket.status)) throw new AppError(409, 'Обращение закрыто для редактирования.');
  if (decision === 'reject') return event({ ...ticket, status: 'rejected' }, 'rejected');
  const reply = redact(checkedText(body.reply, 6000));
  if (decision === 'edit') return event({ ...ticket, draftReply: reply, status: 'edited' }, 'edited');
  return event({ ...ticket, draftReply: reply, status: deliveryMode ? 'delivering' : 'approved_demo' }, 'approved');
}

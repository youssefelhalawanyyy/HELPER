import type { DevDeckState } from '@/hooks/useDevDeckSocket';
import { PAGES, type DeckViewId } from '@/components/shell/LeftNavRail';
import type { ClientEvent } from '@/types/protocol';
import { makeRequestId } from './formatters';

const memoryKey = 'devdeck.nour.facts.v1';
function facts(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    return Array.isArray(data) ? data.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[\u064b-\u065f]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[٠-٩]/g, (n) => String(n.charCodeAt(0) - 1632))
    .trim();
}

export function localNourCommand(
  input: string,
  deck: DevDeckState,
  navigate: (page: DeckViewId) => void,
): string | null {
  const clean = input.replace(/^(?:يا\s*)?(?:نور|nour|noor)[\s،,:]+/i, '').trim();
  const text = normalize(clean);
  const remember = /^(?:remember(?: that)?|افتكري|احفظي|خليكي فاكره)\s+(.+)/i.exec(clean);
  if (remember) {
    const saved = Array.from(new Set([...facts(), remember[1].slice(0, 500)])).slice(-100);
    localStorage.setItem(memoryKey, JSON.stringify(saved));
    return 'حفظتها على الموبايل.';
  }
  if (/^(?:forget everything|clear (?:your )?memory|امسحي الذاكر[هة])$/.test(text)) {
    if (window.confirm('Clear all saved Nour memories on this device?')) {
      localStorage.removeItem(memoryKey);
      return 'مسحت الذاكرة.';
    }
    return 'تمام، خليتها.';
  }
  if (/^(?:recall|what do you remember|فاكره ايه|فاكرة ايه|فكريني)/.test(text)) {
    return facts().join('، ') || 'لسه مفيش حاجة محفوظة.';
  }
  if (/^(?:what(?:'s| is| are) my|when is my|ايه (?:اسمي|مشروعي|مواعيدي|تفضيلاتي)|امتي معادي)/.test(text)) {
    const topics = [
      /project|مشروع/,
      /name|اسم/,
      /schedule|meeting|appointment|موعد|معاد|مواعيد|اجتماع/,
      /prefer|favou?rite|بحب|تفضيل/,
    ];
    const topic = topics.find((group) => group.test(text));
    const words = text.split(/\s+/).filter((w) => w.length > 3 && !['what', 'when'].includes(w));
    const matches = facts().filter((f) =>
      topic ? topic.test(normalize(f)) : words.some((w) => normalize(f).includes(w)),
    );
    return matches.join('، ') || 'مفيش معلومة محفوظة عن ده.';
  }
  const page = PAGES.find((p) =>
    [p.title, p.label, p.id].some((label) =>
      ['open ', 'show ', 'افتحي '].some((v) => text === v + normalize(label)),
    ),
  );
  if (page) {
    navigate(page.id);
    return 'فتحت ' + page.title;
  }
  const requestId = makeRequestId();
  const send = (event: ClientEvent) =>
    deck.sendEvent(event) ? 'بعت الطلب للكمبيوتر.' : 'وصلي الكمبيوتر الأول.';
  const press = /^(?:press|tap|click|اضغطي(?: علي| على)?)\s+(.+)$/.exec(text);
  if (press) {
    const matches = Array.from(document.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter(
      (button) =>
        button.getClientRects().length &&
        [button.getAttribute('aria-label'), button.innerText].some(
          (label) => label && normalize(label) === press[1],
        ),
    );
    if (matches.length !== 1) return 'قولي اسم زرار ظاهر ومميز في الصفحة.';
    if (!window.confirm('Activate “' + press[1] + '”?')) return 'تمام، لغيت الطلب.';
    matches[0].click();
    return 'ضغطت على الزرار.';
  }
  if (/^(?:wake (?:the )?(?:display|screen)|صحي الشاشة)$/.test(text))
    return send({ type: 'hardware:wake', payload: { requestId } });
  if (/^(?:mute|اكتمي الصوت)$/.test(text))
    return send({ type: 'hardware:mute', payload: { requestId, muted: true } });
  if (/^(?:unmute|افتحي الصوت)$/.test(text))
    return send({ type: 'hardware:mute', payload: { requestId, muted: false } });
  if (/^(?:next track|الاغنية اللي بعدها)$/.test(text))
    return send({ type: 'media:control', payload: { requestId, action: 'next' } });
  if (/^(?:previous track|الاغنية اللي قبلها)$/.test(text))
    return send({ type: 'media:control', payload: { requestId, action: 'prev' } });
  const brightness = /^(?:set brightness|اضبطي السطوع)\s*(?:to|علي|على)?\s*(\d{1,3})/.exec(text);
  if (brightness && Number(brightness[1]) <= 100)
    return send({
      type: 'hardware:dial',
      payload: { mode: 'brightness', delta: 0, value: Number(brightness[1]) },
    });
  const port = /^(?:اقفلي|اقفل|close|stop|kill)\s+(?:ال)?(?:بورت|port)\s*(\d+)\s*[.!؟]?$/.exec(text);
  if (port) {
    const listener = deck.ports.find((p) => p.port === Number(port[1]));
    if (!listener) return 'البورت ده مش ظاهر في قائمة البورتات.';
    if (!window.confirm('Stop the process listening on port ' + listener.port + '?'))
      return 'تمام، لغيت الطلب.';
    return send({ type: 'port:kill', payload: { requestId, pid: listener.pid, port: listener.port } });
  }
  if (/^(?:(?:اعملي|اعمل|run|please)\s+)?(?:git push|جيت بوش)[.!]?$/.test(text)) {
    if (!window.confirm('Push the current desktop project to its Git remote?')) return 'تمام، لغيت الطلب.';
    return send({ type: 'git:deploy', payload: { requestId, action: 'push' } });
  }
  if (/^(?:وطي|علي|اضبطي|set|lower|raise).*?(?:الصوت|volume)/.test(text)) {
    const value = /(?:half|للنص|النص|نص)/.test(text) ? 50 : Number(text.match(/\d+/)?.[0]);
    if (!Number.isFinite(value) || value > 100) return 'عايزة الصوت كام في المية؟';
    return send({ type: 'hardware:dial', payload: { mode: 'volume', delta: 0, value } });
  }
  if (/^(?:اقر[ايئ]+|read).*?(?:رساله|رسالة|message)/.test(text)) {
    return (
      [...deck.antigravityState.chatTurns]
        .reverse()
        .find((t) => t.role === 'agent' && t.text)
        ?.text.slice(0, 1400) || 'مفيش رسالة من أنتيجرافيتي دلوقتي.'
    );
  }
  if (/^(?:شغلي|فعل[ي]?|enable|start|turn on).*?(?:التبريد|cooling)/.test(text))
    return send({ type: 'power:fanMode', payload: { requestId, mode: 'max' } });
  if (/^(?:low power mode|enable low power mode|شغلي وضع توفير الطاق[هة])$/.test(text))
    return send({ type: 'power:profile', payload: { requestId, profile: 'eco' } });
  if (/^(?:scan computer|افحصي الجهاز)$/.test(text))
    return send({ type: 'doctor:scan', payload: { requestId } });
  if (/^(?:scan network|افحصي الشبك[هة])$/.test(text))
    return send({ type: 'network:scan', payload: { requestId } });
  if (/^(?:play music|pause music|شغلي الموسيقي|وقفي الموسيقي)$/.test(text))
    return send({ type: 'media:control', payload: { requestId, action: 'playpause' } });
  const macro = deck.config?.macros.find((m) =>
    ['run ', 'شغلي ', 'نفذي '].some((v) => text === v + normalize(m.label)),
  );
  if (macro && macro.actionType !== 'voice') {
    if (!window.confirm('Run saved macro “' + macro.label + '”?')) return 'تمام، لغيت الطلب.';
    return send({ type: 'macro:execute', payload: { requestId, macroId: macro.id } });
  }
  return null;
}

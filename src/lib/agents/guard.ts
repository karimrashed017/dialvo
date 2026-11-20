// Checks that don't depend on the model doing the right thing.

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// 14 to 16 digits, optionally grouped with single spaces or dashes: the
// lengths the card networks in use issue.
const CARD_LIKE = /(?<!\d)\d(?:[ -]?\d){13,15}(?!\d)/g;

export const CARD_REMOVED = "[card number removed]";

/**
 * Takes payment card numbers out of a text before it is stored or shown to
 * the model. Payments only ever happen through a link the team sends, so a
 * card number typed into a chat should not sit in anyone's inbox.
 *
 * A number counts as a card when it has a card's length, starts the way
 * cards do (2 to 6) and passes the check-digit test. That keeps phone
 * numbers, order numbers and timestamps out of it, at the cost of letting
 * through the one in ten random numbers of that shape that happen to pass.
 */
export function redactCardNumbers(text: string): string {
  return text.replace(CARD_LIKE, (match) => {
    const digits = match.replace(/\D/g, "");
    return /^[2-6]/.test(digits) && luhn(digits) ? CARD_REMOVED : match;
  });
}

export function containsCardNumber(text: string): boolean {
  return redactCardNumbers(text) !== text;
}

const STOP =
  /\b(unsubscribe|opt(?:ing)? ?out|do ?n[o']t (?:contact|message|email|call|text) me|stop (?:contacting|messaging|emailing|calling|texting) me|remove me from|leave me alone)\b/i;

/**
 * A plain request to stop being contacted. The model is asked to notice
 * these too; this is the backstop, so an opt-out is honoured even if it
 * doesn't.
 */
export function asksToStop(text: string): boolean {
  return STOP.test(text);
}

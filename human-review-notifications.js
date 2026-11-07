import nodemailer from 'nodemailer';
import { reviewWordCount, reviewWordLanguage } from './human-review-pricing.js';
import { REVIEW_ADMINS } from './human-review.js';

export function reviewMailOptions(env = process.env) {
    const port = Number(env.SMTP_PORT || 465);
    return { host: env.SMTP_HOST || 'mail.privateemail.com', port, secure: port === 465, requireTLS: true, auth: { user: env.SMTP_USER || 'support@shiroko.tools', pass: env.SMTP_PASSWORD }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000, tls: { minVersion: 'TLSv1.2' } };
}
export function createReviewNotifier({ store, persist, transport, env = process.env }) {
    let running;
    let mailer = transport;
    return function notify() {
        if (running) return running;
        running = (async () => {
            if (!env.SMTP_PASSWORD && !transport) return;
            mailer ||= nodemailer.createTransport(reviewMailOptions(env));
            for (const request of store.humanReviewRequests || []) {
                const notification = request.notification;
                if (!notification || notification.status === 'sent' || notification.nextAttemptAt > Date.now()) continue;
                if (!['queued', 'in_review'].includes(request.status)) continue;
                notification.attempts++;
                try {
                    const dashboard = new URL('/app.html?reviews=manage', env.APP_URL || 'https://translate.shiroko.tools');
                    dashboard.hash = request.id;
                    const result = await mailer.sendMail({
                        from: env.HUMAN_REVIEW_FROM_EMAIL || 'Shiroko <support@shiroko.tools>',
                        to: REVIEW_ADMINS,
                        messageId: `<human-review-${request.id}@shiroko.tools>`,
                        subject: `New English–Korean human review · ${reviewWordCount(request)} words`,
                        text: `A new human review request is ready.\n\nRequest: ${request.id}\nCustomer: ${request.customerEmail || request.customerName || 'Signed-in customer'}\nDirection: ${request.direction === 'en-ko' ? 'English → Korean' : 'Korean → English'}\n${reviewWordLanguage(request) === 'ko' ? 'Korean' : 'English'} words: ${reviewWordCount(request)}\nPages (250 words): ${request.pages}\nPrice: $${(request.priceMicros / 1_000_000).toFixed(2)}\n\nOpen the signed-in review dashboard:\n${dashboard.href}\n\nThe original and draft are available inside the dashboard.`
                    });
                    if (result.rejected?.length) throw new Error('A notification recipient was rejected');
                    notification.status = 'sent';
                    notification.providerId = result.messageId;
                    notification.sentAt = new Date().toISOString();
                    delete notification.lastError;
                    delete notification.nextAttemptAt;
                } catch {
                    notification.lastError = 'SMTP notification delivery failed';
                    notification.nextAttemptAt = Date.now() + Math.min(3600_000, 60_000 * 2 ** Math.min(notification.attempts - 1, 6));
                }
                await persist();
            }
        })().catch(error => { console.error('Could not persist review notification status:', error.message); }).finally(() => { running = undefined; });
        return running;
    };
}

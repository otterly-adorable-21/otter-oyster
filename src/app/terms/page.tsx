import Link from 'next/link';
import { Doc } from '@/components/Doc';
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/legal';

export const metadata = { title: `Terms and privacy | ${SITE_NAME}` };

// NOTE: This is a plain-English draft. Have a lawyer who works with adult-content platforms review it before launch.
// Fill in: governing law / location, and a copyright (DMCA) agent if you are in the United States.
export default function Terms() {
  return (
    <Doc title="Terms and privacy">
      <p>These terms are an agreement between you and the operator of {SITE_NAME} (&quot;we&quot;, &quot;us&quot;). By using the site, you agree to them and to our <Link href="/rules">Content rules</Link>. If you do not agree, please do not use the site.</p>

      <h2>1. What the site is</h2>
      <p>{SITE_NAME} lets creators make a page, publish posts, set up membership tiers, and link to a payment service (Gank) where supporters pay. We host pages and posts and unlock them for supporters. <strong>We do not take or process payments.</strong> Payments, refunds, taxes and payouts are handled by Gank under Gank&apos;s own terms.</p>

      <h2>2. Who can use it</h2>
      <ul>
        <li>You must be <strong>18 or older</strong> to create a page. Fans who want to see adult content must also be 18 or older and confirm it.</li>
        <li>You must be able to make a binding agreement where you live, and the law must allow you to use the site.</li>
        <li>Keep your email account secure. Anyone who can open your sign-in emails can access your account.</li>
      </ul>

      <h2>3. Your account and your content</h2>
      <ul>
        <li>You own your content. By posting it, you give us permission to store, display and deliver it on the site so the service works, including to your supporters. This permission ends when you delete the content or your account, apart from short-term backups.</li>
        <li>You promise that you have the right to post what you post, that it follows the <Link href="/rules">Content rules</Link>, and that any person shown in real photos or video is an adult who agreed to it.</li>
        <li>You are responsible for everything on your page, including AI-generated content, and for following the laws that apply to you, including tax and age-verification rules.</li>
        <li>Creators are responsible for any records the law requires them to keep about the people in their content.</li>
      </ul>

      <h2>4. Supporters and access</h2>
      <p>Access to locked posts is based on the email address used for a payment on Gank. You sign in here with the same email, or link a second email on a creator&apos;s page. Access can take a short time to appear after you pay. A tier&apos;s access may end after cancellation, a refund or a payment problem. Because payments happen on Gank, questions about charges and refunds go to Gank and the creator, not to us.</p>

      <h2>5. What we can do</h2>
      <p>We may remove or hide content, suspend a page, or close an account if it breaks these terms or the Content rules, if the law requires it, or if it puts people at risk. We may change or stop parts of the site. We try to give notice where we can, but we may act right away in serious cases.</p>

      <h2>6. Deleting your account</h2>
      <p>Creators can delete their account in the studio. This permanently removes the page, tiers, posts, uploaded images and sign-in. Records of past payments are held by Gank, not by us.</p>

      <h2>7. Copyright complaints</h2>
      <p>If you believe something on the site copies your work without permission, send us a report through the <Link href="/report">report form</Link>{CONTACT_EMAIL ? <> or at {CONTACT_EMAIL}</> : null}. Include what was copied, where it appears, and how to reach you. We may remove the content and tell the person who posted it.</p>

      <h2>8. Privacy</h2>
      <ul>
        <li><strong>What we collect:</strong> your email address, a sign-in session (a cookie), the content you upload, and, for creators, the page details you enter. We store records of payment notifications from Gank (the supporter&apos;s email, the creator and tier, dates), so we can unlock the right posts.</li>
        <li><strong>Cookies:</strong> we use a sign-in cookie and small cookies that remember your age confirmation and your &quot;hide 18+ posts&quot; choice. We do not use advertising cookies.</li>
        <li><strong>What we do with it:</strong> run the site, unlock posts, send sign-in emails, prevent abuse, and answer reports. We do not sell your information.</li>
        <li><strong>Who sees it:</strong> email delivery and hosting services that help us run the site, and authorities when the law requires it. Creators do not see their supporters&apos; email addresses through this site.</li>
        <li><strong>Your choices:</strong> creators can delete their account in the studio. {CONTACT_EMAIL ? <>For anything else, write to {CONTACT_EMAIL}.</> : <>For anything else, use the report form and choose &quot;Other&quot;.</>}</li>
      </ul>

      <h2>9. No promises, and limits</h2>
      <p>The site is provided &quot;as is&quot;. We try to keep it running and accurate, but we cannot promise it will always be available, error-free, or that every payment will unlock access instantly. To the extent the law allows, we are not responsible for lost income, lost data, payment-service decisions, or things other users post. Nothing here limits rights you have under the law that cannot be limited.</p>

      <h2>10. Changes</h2>
      <p>We may update these terms. The date at the top shows the latest version. If you keep using the site after a change, you accept the new terms.</p>

      <h2>11. Contact</h2>
      <p>{CONTACT_EMAIL ? <>Write to {CONTACT_EMAIL} or use</> : <>Use</>} the <Link href="/report">report form</Link>.</p>
    </Doc>
  );
}

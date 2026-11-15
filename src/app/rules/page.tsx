import Link from 'next/link';
import { Doc } from '@/components/Doc';
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/legal';

export const metadata = { title: `Content rules | ${SITE_NAME}` };

// NOTE: This is a plain-English draft. Have a lawyer who works with adult-content platforms review it before launch.
export default function Rules() {
  return (
    <Doc title="Content rules">
      <p>{SITE_NAME} is a place for creators to share work with supporters, including AI-generated art and adult (18+) content. Adults can make and see adult work here. These rules keep that safe and legal. They apply to everything you post, upload, write or link.</p>

      <h2>1. Never allowed, with no exceptions</h2>
      <ul>
        <li><strong>Anyone under 18.</strong> No sexual or sexualized content involving a minor. This includes real people, drawings, and AI-generated images. It also includes characters who look like children or are described as children, even if the character is called an adult or is said to be centuries old.</li>
        <li><strong>Real people.</strong> No sexual or intimate content of a real person made without their clear permission. This includes AI-generated or edited images, face swaps, and deepfakes. Never post private or intimate images of someone who did not agree to it being shared.</li>
        <li><strong>Anything that is illegal</strong> where you live or where we operate, including content you do not have the right to share.</li>
        <li><strong>Real-world violence and abuse.</strong> No real footage or images of someone being seriously hurt or abused, and no content that promotes it.</li>
        <li><strong>Exploitation and trafficking.</strong> Nothing that shows or promotes people being forced, coerced, trafficked or exploited.</li>
      </ul>

      <h2>2. Adult content (18+)</h2>
      <ul>
        <li>Mark every adult post as <strong>18+</strong> when you create it. Fans are asked to confirm they are 18 or older before they can see those posts.</li>
        <li>Adult content must not appear in your page name, profile picture, banner, bio, divider or any other part of your page that everyone can see. Keep adult work inside posts marked 18+.</li>
        <li>Do not use post titles that describe sexual acts in explicit detail. The title of a locked or age-gated post is visible to everyone.</li>
        <li>You must be 18 or older to make a page here.</li>
      </ul>

      <h2>3. Be honest about what it is</h2>
      <ul>
        <li>Do not claim someone else&apos;s work as yours.</li>
        <li>Do not post work you do not have the rights to. That includes other artists&apos; images, music, or text.</li>
        <li>Do not imitate another creator or a real person in a way that could mislead supporters.</li>
      </ul>

      <h2>4. Treat people decently</h2>
      <ul>
        <li>No harassment, threats, stalking, or publishing someone&apos;s private information.</li>
        <li>No hate speech or content that attacks people for who they are.</li>
        <li>No spam, scams, or tricking supporters into paying for something you will not deliver.</li>
      </ul>

      <h2>5. Money</h2>
      <p>Payments happen on Gank, not on {SITE_NAME}. Your content must also follow the rules of the payment service you use. If that service closes your account or refuses a payment, {SITE_NAME} cannot overrule it. Do not use your page to move money in ways that break the law.</p>

      <h2>6. Reporting and enforcement</h2>
      <p>Anyone can report a page or post using the <Link href="/report">report form</Link>{CONTACT_EMAIL ? <> or by writing to {CONTACT_EMAIL}</> : null}. Reports involving minors or non-consensual content are handled first.</p>
      <p>If something breaks these rules, we may remove it, hide it, suspend a page, or delete an account, with or without warning, depending on how serious it is. We may also keep records and give them to the authorities when the law requires it or when a child may be at risk. Serious cases involving minors are reported to the appropriate authorities.</p>
      <p>If you think we made a mistake, write to us and explain. We will look at it again.</p>

      <p>These rules work together with our <Link href="/terms">Terms</Link>.</p>
    </Doc>
  );
}

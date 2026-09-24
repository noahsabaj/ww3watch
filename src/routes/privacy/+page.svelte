<script>
  import { base } from '$app/paths'
  import PageShell from '$lib/components/PageShell.svelte'
</script>

<PageShell title="Privacy" lede="No visitor accounts, no advertising trackers, no visitor analytics.">
  <div class="page-prose">
  <p>WW3Watch has no visitor accounts, advertising trackers or visitor analytics. Your browser stores your reading language, whether you dismissed the install prompt, your last-visit time, which tips you have already used and a copy of the latest stories so the app opens without waiting, all locally. You can remove them through your browser's site-data settings.</p>
  <h2 class="mt-10 mb-3 font-serif text-2xl text-fg">Requests and security</h2>
  <p>GitHub hosts this site and Supabase provides its data and functions. These providers receive network information, including your IP address, when your browser connects. WW3Watch stores daily keyed identifiers, rather than raw IP addresses, for abuse prevention. These expire after 48 hours and are removed by hourly cleanup. Provider infrastructure logs are governed by their own policies.</p>
  <h2 class="mt-10 mb-3 font-serif text-2xl text-fg">Articles and translation</h2>
  <p>Opening an article can load images from the publisher, which receives your network information. The home page also loads a publisher photograph in your browser when the newsroom attached one to the story; stories without a photograph show a colour field instead of a generated or stock image. Selecting translation sends the article text and chosen language to our configured translation provider. Avoid including personal information in requests. Original reporting remains available without translation.</p>
  <h2 class="mt-10 mb-3 font-serif text-2xl text-fg">Alerts</h2>
  <p>Alerts are off unless you turn them on in the menu. Turning them on gives WW3Watch your browser's push address for this site, issued by your browser's push service (Apple, Google, Mozilla or Microsoft), and nothing else: no account, name or email. It is used only to send an alert when a world-changing event is confirmed, and it is deleted when you turn alerts off, or when the push service reports that the address no longer works.</p>
  <h2 class="mt-10 mb-3 font-serif text-2xl text-fg">Feedback</h2>
  <p>Feedback is private to the maintainer. An email address is optional and is used only to respond. Do not send passwords or sensitive personal information. Reports are not published automatically. Reports and optional email addresses expire after 90 days, with hourly cleanup; encrypted backups may retain a copy for up to seven additional days.</p>
  <p><a class="link" href="{base}/feedback">Contact the maintainer or request removal of a report</a>.</p>
  </div>
</PageShell>

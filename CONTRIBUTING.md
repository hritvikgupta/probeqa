# Contributing to Probe

Thanks for taking the time. Bug reports and pull requests are welcome.

## Getting set up

```bash
npm install
npx playwright install chromium
cp .env.example .env      # DATABASE_URL + OPENROUTER_API_KEY
npm run db:push
npm run dev
```

## Where to contribute

The agent's quality is mostly its **perception**. If you find a widget the
agent misreads, the fix usually belongs in `server/browser.ts` — teaching
`inspect_page()` to describe that pattern — rather than in the prompt.

Rules worth preserving:

- **One tool call per reasoning step.** The loop stays debuggable because each
  step has exactly one action and one observation.
- **Never act on an unobserved element.** The agent may only click or fill
  something it just saw in an `inspect_page` / `get_html` result.
- **Active scope is authoritative.** While a dialog or menu is open, only
  controls inside it are eligible. This is what stops clicks landing behind
  overlays.
- **Accessibility tree first, DOM last.** `get_html()` is the fallback, not the
  default — it is large, slow and noisy.
- **No source access.** Probe tests the running app through the browser only.
  Anything that reads the app's code breaks the guarantee the product makes.


## Pull requests

- Branch off `main`, keep the change focused.
- Explain *why* in the description; the diff already shows the what.
- Include a test for behaviour changes.
- Note any schema change and commit the migration alongside it.

## Reporting bugs

Open an issue with the version, what you expected, what happened, and the
smallest reproduction you can manage. Redact keys and connection strings.

## Security

Do not open a public issue for a vulnerability. Email
[hritvik2920@gmail.com](mailto:hritvik2920@gmail.com) and allow a reasonable
window for a fix before disclosure.

## License

By contributing, you agree your contributions are licensed under the
[GNU AGPL-3.0](LICENSE).

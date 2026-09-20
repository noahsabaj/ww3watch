# WW3Watch operations

## Domain cutover and recovery

The production workflow reads the repository variable `PAGES_BASE_PATH`.
Use `/ww3watch` for the original GitHub Pages address and an empty value for
`ww3watch.org`. The recovery build omits CNAME and preserves a prerendered index.

Recovery: set `PAGES_BASE_PATH=/ww3watch`, deploy the matching build, then clear
the GitHub Pages custom-domain setting. Check the original URL, assets, and a
reader query link. Never clear the domain while serving root-only asset paths.

Cutover: verify public DNS points to GitHub Pages, set the custom domain, clear
`PAGES_BASE_PATH`, and deploy. Verify GitHub certificate issuance and enable
HTTPS enforcement. Check apex, www, HTTP, the old GitHub URL, and reader query
links from public clients. If certificate issuance remains blocked, restore the
recovery build and setting. A successful DNS lookup alone is not acceptance.

GitHub provisions the certificate only while the custom domain is attached;
allow a supervised cutover window and retain the prior successful deployment.

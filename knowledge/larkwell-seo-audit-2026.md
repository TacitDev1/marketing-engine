# Larkwell SEO audit, autumn 2026

Audit of larkwell.example, October 2026. Overall score: 71 out of 100. (Invented sample data.)

## Technical findings

- Issue: 14 news posts have no meta description, so Google writes its own snippet from the first paragraph. Fix: add a 140 to 160 character description to every post; the Blogs screen writes one with each draft.
- Issue: service pages load a 1.2 MB hero image. Fix: serve responsive images; Lighthouse estimates 96 KiB saved on the home page alone.
- Issue: the sitemap lists four draft posts. Fix: exclude `draft: true` entries from the sitemap build.

## Content findings

- Recommendation: the plant maintenance service page ranks on page two for "sap plant maintenance consultant". It needs a section on field apps and a link from the work orders post.
- Recommendation: no page targets "sap waste management", though the site is seen for it 1,490 times a quarter. An industry page for waste operators would fix this.
- Issue: two posts compete for "billing exceptions". Fix: merge the older one into "Billing exceptions have causes" and redirect it.

## Schema and structure

- Recommendation: add Organization and Article structured data. No page has schema today.
- Issue: the success stories have no client logo alt text. Fix: describe each logo by the client's name.

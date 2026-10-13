# Polyglot Page Translator v0.3.2 - AMO Notes

What's New in Version 0.3.2:

- Automatic Translation Options & Domain List:
  Added a master toggle to automatically translate all webpages on load, as well as an interactive website list editor in Options to easily add and remove specific domains.
- Options Page Aesthetic & Favicon:
  Added favicon to the settings tab and updated header branding with extension icon and clear labeling. Fixed an options initialization issue to ensure configured domain lists render reliably on every visit.

- Strict Script & Internal Asset Isolation:
  Completely blocks modern SPA inline `<script>` tags, template loaders, and framework module scripts (such as Reddit's internal `SML.load` lazy-bundle loaders) from being parsed or injected into the page as text.

- Code & Syntax Heuristic Filter:
  Added intelligent syntax detection to reject raw JavaScript closures, functions, JSON payloads, and code-dense snippets from being treated as translatable human prose.

- Enhanced Web Component & SPA Layout Protection:
  Added intelligent custom element classification and structural element safeguards. Web components (such as modern Reddit's `<shreddit-*>` and `<faceplate-*>` tags) are now strictly recognized as independent structural boundaries. Prevents layout containers from being improperly flattened into single plain-text blocks.

- Precision Leaf-Level DOM Targeting:
  Enforced strict phrasing tag analysis (`<a>`, `<b>`, `<i>`, `<span>`). Translation targets leaf content directly while leaving top-level containers, navigation chrome, and interactive post controls intact.
  Switched to the high-performance multi-query batch endpoint (`clients5.google.com/translate_a/t?client=dict-chrome-ex`), bundling requests in batches of 25 with independent per-item language detection. Completely eliminates HTTP 429 rate limiting and dramatically speeds up full-page translation.

- Mixed-Container DOM Parsing:
  Added intelligent inline run segmentation to extract translatable text from complex mixed containers (such as Wikipedia Embassy welcome messages that share container divs with action buttons).

- Context Menu Integration:
  Right-click anywhere to trigger "Translate Page (Multi-Language)" or "Translate Selection" with a single click.

- Unobtrusive UI:
  Removed the floating in-page restore banner to keep web page layouts clean and unobscured. Page status and controls remain readily accessible from the toolbar popup and context menu.

- Navigation & Menu Filtering:
  Automatically filters out navigation bars, edit links, and sidebar boilerplate to prioritize core article content.

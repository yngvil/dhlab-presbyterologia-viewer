const TEI_PATH = "./data/Presbyterologia.xml";
const IMAGE_BASE_URL =
  "https://www.nb.no/items/URN:NBN:no-nb_digibok_2015121628005?page=";

const textGrid = document.getElementById("text-grid");
const tocList = document.getElementById("toc-list");
const sourceControls = document.getElementById("source-controls");
const pickTeiBtn = document.getElementById("pick-tei");
const teiFileInput = document.getElementById("tei-file");
const sourceStatus = document.getElementById("source-status");
const aboutOpenBtn = document.getElementById("about-open");
const aboutCloseBtn = document.getElementById("about-close");
const aboutModal = document.getElementById("about-modal");
const RELAYOUT_SETTLE_DELAYS = [120, 400];
const TOC_MAX_WORDS = 10;
const TOC_MAX_CHARS = 50;
let pageMarkerLayouts = [];
let resizeBound = false;
let relayoutRaf = null;

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function hasRunic(text) {
  return /[\u16A0-\u16FF]/.test(text || "");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.nodeValue || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  if (node.localName === "hi") {
    const rend = node.getAttribute("rend");
    const inner = Array.from(node.childNodes)
      .map(renderInline)
      .join("");
    if (rend === "bold") return `<strong>${inner}</strong>`;
    if (rend === "italic") return `<em>${inner}</em>`;
    return `<span>${inner}</span>`;
  }

  if (node.localName === "head") {
    return Array.from(node.childNodes).map(renderInline).join("");
  }

  if (node.localName === "quote") {
    const inner = Array.from(node.childNodes).map(renderInline).join("");
    return `<span class="quote-span">${inner}</span>`;
  }

  if (node.localName === "bibl") {
    const inner = Array.from(node.childNodes).map(renderInline).join("");
    return `<span class="bibl-span">${inner}</span>`;
  }

  if (node.localName === "byline") {
    const inner = Array.from(node.childNodes).map(renderInline).join("");
    return `<span class="byline-span">${inner}</span>`;
  }

  if (node.localName === "lb") {
    return "<br />";
  }

  return Array.from(node.childNodes).map(renderInline).join("");
}

function renderSegHtml(seg) {
  const raw = Array.from(seg.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return escapeHtml(node.nodeValue || "");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }
      // Keep only inline content for a segment. Broken XML can nest new
      // <seg> blocks inside an open segment; those must be handled separately.
      if (
        node.localName === "hi" ||
        node.localName === "head" ||
        node.localName === "quote" ||
        node.localName === "bibl" ||
        node.localName === "byline" ||
        node.localName === "lb"
      ) {
        return renderInline(node);
      }
      return "";
    })
    .join("");
  return normalizeText(raw);
}

function renderHeadHtml(headNode) {
  const raw = Array.from(headNode.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return escapeHtml(node.nodeValue || "");
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }
      return renderInline(node);
    })
    .join("");
  return normalizeText(raw);
}

function appendInlineSegContent(segNode, container, inlineAnchors) {
  const appendNode = (node, target) => {
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(node.nodeValue || ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    if (node.localName === "pb") {
      const facs = node.getAttribute("facs");
      const page = facs ? extractPageNumber(facs) : null;
      const suffix = facs ? extractPageSuffix(facs) : null;
      const value = page || suffix;
      if (value) {
        const anchor = document.createElement("span");
        anchor.className = "pb-anchor";
        anchor.setAttribute("aria-hidden", "true");
        target.appendChild(anchor);
        inlineAnchors.push({ page: value, anchor });
      }
      return;
    }

    if (node.localName === "hi") {
      const rend = node.getAttribute("rend");
      let el = document.createElement("span");
      if (rend === "bold") el = document.createElement("strong");
      if (rend === "italic") el = document.createElement("em");
      Array.from(node.childNodes).forEach((child) => appendNode(child, el));
      target.appendChild(el);
      return;
    }

    if (node.localName === "head") {
      Array.from(node.childNodes).forEach((child) => appendNode(child, target));
      return;
    }

    if (node.localName === "quote") {
      const el = document.createElement("span");
      el.className = "quote-span";
      Array.from(node.childNodes).forEach((child) => appendNode(child, el));
      target.appendChild(el);
      return;
    }

    if (node.localName === "bibl") {
      const el = document.createElement("span");
      el.className = "bibl-span";
      Array.from(node.childNodes).forEach((child) => appendNode(child, el));
      target.appendChild(el);
      return;
    }

    if (node.localName === "byline") {
      const el = document.createElement("span");
      el.className = "byline-span";
      Array.from(node.childNodes).forEach((child) => appendNode(child, el));
      target.appendChild(el);
      return;
    }

    if (node.localName === "lb") {
      target.appendChild(document.createElement("br"));
    }
  };

  Array.from(segNode.childNodes).forEach((child) => appendNode(child, container));
}

function getByLocalName(node, localName) {
  return Array.from(node.getElementsByTagNameNS("*", localName));
}

function parseNoteBlock(noteEl, index) {
  const directSegs = Array.from(noteEl.children).filter(
    (child) => child.localName === "seg"
  );
  const latinSeg = directSegs.find(
    (seg) => seg.getAttribute("xml:lang") === "la"
  );
  const norSeg = directSegs.find(
    (seg) => seg.getAttribute("xml:lang") === "no"
  );

  return {
    id: `note-${index + 1}`,
    la: latinSeg ? normalizeText(latinSeg.textContent) : "",
    no: norSeg ? normalizeText(norSeg.textContent) : "",
  };
}

function extractPageNumber(filename) {
  const match = filename.match(/_(\d+)\.[a-z]+$/i);
  if (!match) return null;
  return String(parseInt(match[1], 10));
}

function extractPageSuffix(filename) {
  const match = filename.match(/_([A-Za-z0-9]+)\.[a-z]+$/i);
  return match ? match[1] : null;
}

function getHeadInfo(seg) {
  const heads = getByLocalName(seg, "head");
  if (!heads.length) {
    return { hasHead: false, level: 1, text: "" };
  }
  const head = heads[0];
  const parsed = parseInt(head.getAttribute("n") || "1", 10);
  const level = Number.isFinite(parsed) ? Math.min(3, Math.max(1, parsed)) : 1;
  return {
    hasHead: true,
    level,
    text: normalizeText(head.textContent || ""),
  };
}

function getParentHead(seg) {
  let current = seg.parentElement;
  while (current) {
    if (current.localName === "head") return current;
    if (current.localName === "div" || current.localName === "p" || current.localName === "body") {
      // Keep walking through structural nodes in case of deeper wrappers.
    }
    current = current.parentElement;
  }
  return null;
}

function parseHeadLevel(headNode) {
  if (!headNode) return 1;
  const parsed = parseInt(headNode.getAttribute("n") || "1", 10);
  return Number.isFinite(parsed) ? Math.min(3, Math.max(1, parsed)) : 1;
}

function pushPageMarker(targetList, marker) {
  const last = targetList[targetList.length - 1];
  if (last && last.page === marker.page) return;
  targetList.push(marker);
}

function buildEntries(doc) {
  const body = getByLocalName(doc, "body")[0] || doc.documentElement;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  const entries = [];
  const entriesById = new Map();
  let currentEntry = null;
  let noteIndex = 0;
  let pendingPageMarkers = [];
  let paragraphIndex = 0;

  const isInMarginNote = (node) => {
    let current = node.parentElement;
    while (current) {
      if (
        current.localName === "note" &&
        current.getAttribute("place") === "margin"
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };

  const isInTitlePage = (node) => {
    let current = node.parentElement;
    while (current) {
      if (
        current.localName === "div" &&
        current.getAttribute("type") === "titlePage"
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };

  const getLang = (node) =>
    node.getAttribute("xml:lang") ||
    node.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") ||
    node.getAttribute("lang");

  const hasLangSegChildren = (node) =>
    Array.from(node.children).some(
      (child) => child.localName === "seg" && Boolean(getLang(child))
    );

  const getParentSeg = (node) => {
    let current = node.parentElement;
    while (current) {
      if (current.localName === "seg" && Boolean(getLang(current))) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  let node = walker.currentNode;
  while (node) {
    if (node.localName === "head") {
      const insideMarginNote = isInMarginNote(node);
      const lang = getLang(node);
      const nestedLangSegs = hasLangSegChildren(node);
      if (!insideMarginNote && !nestedLangSegs && (lang === "la" || lang === "no")) {
        const id = node.getAttribute("xml:id");
        const corresp = node.getAttribute("corresp")?.replace("#", "");
        const parsed = parseInt(node.getAttribute("n") || "1", 10);
        const headLevel = Number.isFinite(parsed)
          ? Math.min(3, Math.max(1, parsed))
          : 1;
        const item = {
          html: renderHeadHtml(node),
          isHead: true,
          headLevel,
          headText: normalizeText(node.textContent || ""),
          segNode: null,
        };

        if (lang === "la") {
          const entryId = id || `auto-head-${entries.length + 1}`;
          currentEntry = {
            id: entryId,
            la: [item],
            no: [],
            notes: [],
            pageMarkers: pendingPageMarkers,
            paragraphIndex,
            isTitlePage: isInTitlePage(node),
          };
          pendingPageMarkers = [];
          entries.push(currentEntry);
          entriesById.set(entryId, currentEntry);
        } else {
          const targetEntry =
            (corresp && entriesById.get(corresp)) || currentEntry;
          if (targetEntry) {
            targetEntry.no.push(item);
          }
        }
      }
    }

    if (node.localName === "seg" && getLang(node)) {
      const lang = getLang(node);
      if (lang === "la" || lang === "no") {
        const insideMarginNote = isInMarginNote(node);
        const hasMainTextId = node.hasAttribute("xml:id");
        const hasMainTextCorresp = node.hasAttribute("corresp");

        // Recovery of broken XML can accidentally nest long main text inside
        // margin notes. Keep true main text segments visible.
        if (
          insideMarginNote &&
          !hasMainTextId &&
          !hasMainTextCorresp
        ) {
          node = walker.nextNode();
          continue;
        }

        const id = node.getAttribute("xml:id");
        const corresp = node.getAttribute("corresp")?.replace("#", "");
        const content = renderSegHtml(node);
        const head = getHeadInfo(node);
        const parentHead = getParentHead(node);
        const parentHeadLevel = parseHeadLevel(parentHead);
        const isHeadFromParent = Boolean(parentHead);
        const item = {
          html: content,
          isHead: head.hasHead || isHeadFromParent,
          headLevel: isHeadFromParent ? parentHeadLevel : head.level,
          headText: isHeadFromParent
            ? normalizeText((parentHead && parentHead.textContent) || node.textContent || "")
            : head.text,
          segNode: lang === "la" ? node : null,
        };

        if (lang === "la") {
          const entryId = id || `auto-${entries.length + 1}`;
          currentEntry = {
            id: entryId,
            la: [item],
            no: [],
            notes: [],
            pageMarkers: pendingPageMarkers,
            paragraphIndex,
            isTitlePage: isInTitlePage(node),
          };
          pendingPageMarkers = [];
          entries.push(currentEntry);
          entriesById.set(entryId, currentEntry);
        } else {
          const targetEntry =
            (corresp && entriesById.get(corresp)) || currentEntry;
          if (targetEntry) {
            targetEntry.no.push(item);
          }
        }
      }
    }

    if (node.localName === "note" && node.getAttribute("place") === "margin") {
      const target = node.getAttribute("target")?.replace("#", "");
      const note = parseNoteBlock(node, noteIndex++);
      if (!note.la && !note.no) {
        node = walker.nextNode();
        continue;
      }
      const targetEntry = (target && entriesById.get(target)) || currentEntry;
      if (targetEntry) {
        targetEntry.notes.push(note);
      }
    }

    if (node.localName === "pb") {
      const facs = node.getAttribute("facs");
      const page = facs ? extractPageNumber(facs) : null;
      const suffix = facs ? extractPageSuffix(facs) : null;
      if (page || suffix) {
        const marker = { page: page || suffix };
        const parentSeg = getParentSeg(node);

        // Page break inside a latin segment is rendered by inline anchors.
        if (
          parentSeg &&
          currentEntry &&
          parentSeg.getAttribute("xml:lang") === "la"
        ) {
          // no-op: handled in appendInlineSegContent for precise placement
        } else if (parentSeg && currentEntry) {
          // Fallback for pb nested in non-latin content.
          currentEntry.pageMarkers = currentEntry.pageMarkers || [];
          pushPageMarker(currentEntry.pageMarkers, marker);
        } else {
          // Page break between segments is attached to the next block.
          pushPageMarker(pendingPageMarkers, marker);
        }
      }
    }

    if (node.localName === "p") {
      paragraphIndex += 1;
    }

    node = walker.nextNode();
  }

  // If trailing pb markers exist after last latin segment, keep them visible.
  if (pendingPageMarkers.length && entries.length) {
    const lastEntry = entries[entries.length - 1];
    const merged = lastEntry.pageMarkers || [];
    pendingPageMarkers.forEach((marker) => pushPageMarker(merged, marker));
    lastEntry.pageMarkers = merged;
  }

  return entries;
}

function toPlainText(html) {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  return normalizeText(temp.textContent || "");
}

function getSectionTitle(entry) {
  const head = (entry.la || []).find((item) => item.isHead);
  if (!head) return null;
  return {
    text: head.headText || toPlainText(head.html),
    level: head.headLevel || 1,
  };
}

function buildSections(entries) {
  const sections = [];
  let current = {
    id: "sec-0",
    title: "Innledning",
    level: 1,
    isTitlePage: false,
    entries: [],
  };

  entries.forEach((entry) => {
    const titleInfo = getSectionTitle(entry);

    if (current.entries.length && Boolean(entry.isTitlePage) !== Boolean(current.isTitlePage)) {
      sections.push(current);
      current = {
        id: `sec-${sections.length + 1}`,
        title: "",
        level: current.level || 1,
        isTitlePage: Boolean(entry.isTitlePage),
        entries: [],
      };
    }

    if (titleInfo) {
      if (current.entries.length) {
        sections.push(current);
      }
      current = {
        id: `sec-${sections.length + 1}`,
        title: titleInfo.text,
        level: titleInfo.level,
        isTitlePage: Boolean(entry.isTitlePage),
        entries: [entry],
      };
      return;
    }
    current.entries.push(entry);
    current.isTitlePage = current.isTitlePage || Boolean(entry.isTitlePage);
  });

  if (current.entries.length) {
    sections.push(current);
  }
  return sections;
}

function createPageMarker(page, inline = false, top = 0) {
  const marker = document.createElement("a");
  marker.className = inline ? "page-marker inline" : "page-marker";
  marker.href = `${IMAGE_BASE_URL}${page}`;
  marker.target = "_blank";
  marker.rel = "noopener";
  marker.innerHTML = `
    <span class="icon" aria-hidden="true"></span>
    <span>Side ${page}</span>
  `;
  if (inline) {
    marker.style.top = `${top}px`;
  }
  return marker;
}

function layoutPageMarkers(pageStrip, leftCol, pageMarkers, inlineAnchors) {
  pageStrip.innerHTML = "";
  pageMarkers.forEach((markerInfo) => {
    pageStrip.appendChild(createPageMarker(markerInfo.page, false));
  });
  if (!inlineAnchors.length) return;

  pageStrip.style.minHeight = `${Math.max(leftCol.scrollHeight, 1)}px`;
  const leftRect = leftCol.getBoundingClientRect();
  const leftTop = leftRect.top + window.scrollY;
  inlineAnchors.forEach((item) => {
    const anchorRect = item.anchor.getBoundingClientRect();
    const anchorTop = anchorRect.top + window.scrollY;
    const top = Math.max(0, anchorTop - leftTop);
    pageStrip.appendChild(createPageMarker(item.page, true, top));
  });
}

function relayoutAllPageMarkers() {
  pageMarkerLayouts.forEach((layout) => {
    if (!layout.pageStrip.isConnected || !layout.left.isConnected) return;
    layoutPageMarkers(
      layout.pageStrip,
      layout.left,
      layout.pageMarkers,
      layout.inlineAnchors
    );
  });
}

function relayoutAllMarginNotes() {
  const NOTE_GAP = 8;
  let lastBottom = -Infinity;

  pageMarkerLayouts.forEach((layout) => {
    const strip = layout.marginStrip;
    if (!strip || !strip.children.length || !strip.isConnected) {
      return;
    }

    strip.style.top = "0px";
    const entryTop = layout.wrapper.getBoundingClientRect().top + window.scrollY;
    const noteHeight = strip.offsetHeight;
    let top = 0;

    if (entryTop + top < lastBottom + NOTE_GAP) {
      top = lastBottom + NOTE_GAP - entryTop;
    }

    strip.style.top = `${Math.max(0, top)}px`;
    lastBottom = entryTop + top + noteHeight;
  });
}

function scheduleRelayout() {
  if (relayoutRaf !== null) {
    cancelAnimationFrame(relayoutRaf);
  }
  relayoutRaf = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      relayoutAllPageMarkers();
      relayoutAllMarginNotes();
      relayoutRaf = null;
    });
  });
}

function buildParagraphFromItems(items, inlineAnchors = null) {
  if (!items.length) return null;
  const paragraph = document.createElement("p");
  items.forEach((item, idx) => {
    if (idx > 0) paragraph.appendChild(document.createTextNode(" "));
    const span = document.createElement("span");
    if (item.isHead) {
      span.className = `head-span head-l${item.headLevel || 1}`;
    }
    if (hasRunic(item.html)) {
      span.classList.add("runic-span");
    }
    if (inlineAnchors && item.segNode) {
      appendInlineSegContent(item.segNode, span, inlineAnchors);
    } else {
      span.innerHTML = item.html;
    }
    paragraph.appendChild(span);
  });
  return paragraph;
}

function buildEntry(entry, state) {
  const wrapper = document.createElement("article");
  wrapper.className = "entry";
  if (
    entry.paragraphIndex !== null &&
    entry.paragraphIndex !== undefined &&
    entry.paragraphIndex !== state.lastParagraphIndex
  ) {
    wrapper.classList.add("paragraph-start");
    state.lastParagraphIndex = entry.paragraphIndex;
  }

  const pageCol = document.createElement("div");
  pageCol.className = "page-col";

  const marginCol = document.createElement("div");
  marginCol.className = "margin-col";

  const left = document.createElement("div");
  left.className = "latin";

  const right = document.createElement("div");
  right.className = "norwegian";

  const pageStrip = document.createElement("div");
  pageStrip.className = "page-strip";
  pageCol.appendChild(pageStrip);

  const marginStrip = document.createElement("div");
  marginStrip.className = "margin-strip";
  marginCol.appendChild(marginStrip);

  const pageMarkers = entry.pageMarkers || [];

  const notes = entry.notes || [];
  if (notes.length) {
    const noteBlock = document.createElement("div");
    noteBlock.className = "margin-note";
    noteBlock.innerHTML = `<div class="label">Marginalia</div>`;
    notes.forEach((note) => {
      const item = document.createElement("div");
      item.className = "note-item";
      item.innerHTML = `
        <div class="note-la">${note.la || ""}</div>
        <div class="note-no">${note.no || ""}</div>
      `;
      noteBlock.appendChild(item);
    });
    marginStrip.appendChild(noteBlock);
  }

  const latinItems = entry.la;
  const inlineAnchors = [];
  const latinParagraph = buildParagraphFromItems(latinItems, inlineAnchors);
  if (latinParagraph) {
    left.appendChild(latinParagraph);
  }

  const norwegianItems = entry.no;
  const norwegianParagraph = buildParagraphFromItems(norwegianItems);
  if (norwegianParagraph) {
    right.appendChild(norwegianParagraph);
  }

  wrapper.appendChild(pageCol);
  wrapper.appendChild(marginCol);
  wrapper.appendChild(left);
  wrapper.appendChild(right);
  return { wrapper, pageStrip, marginStrip, left, pageMarkers, inlineAnchors };
}

function buildToc(sections) {
  if (!tocList) return;
  tocList.innerHTML = "";
  sections.forEach((section) => {
    if (!normalizeText(section.title || "")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `toc-link level-${section.level || 1}`;
    const shortTitle = truncateTocTitle(section.title);
    btn.textContent = shortTitle;
    if (shortTitle !== section.title) {
    btn.title = section.title;
    }
    btn.addEventListener("click", () => {
      const sectionEl = document.getElementById(section.id);
      if (!sectionEl) return;
      sectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    tocList.appendChild(btn);
  });
}

function truncateTocTitle(title) {
  const normalized = normalizeText(title || "");
  if (!normalized) return "";
  const words = normalized.split(" ");
  const byWords = words.length > TOC_MAX_WORDS;
  const byChars = normalized.length > TOC_MAX_CHARS;
  if (!byWords && !byChars) return normalized;

  if (byWords) {
    const wordLimited = words.slice(0, TOC_MAX_WORDS).join(" ");
    if (wordLimited.length <= TOC_MAX_CHARS) {
      return `${wordLimited} (...)`;
    }
    return `${wordLimited.slice(0, TOC_MAX_CHARS).trim()} (...)`;
  }
  return `${normalized.slice(0, TOC_MAX_CHARS).trim()} (...)`;
}

function buildText(entries) {
  if (!entries.length) {
    textGrid.innerHTML = "<p class='muted'>Ingen tekst funnet.</p>";
    if (tocList) tocList.innerHTML = "<p class='muted'>Ingen overskrifter funnet.</p>";
    return;
  }

  textGrid.innerHTML = "";
  const sections = buildSections(entries);
  const state = { lastParagraphIndex: null };
  pageMarkerLayouts = [];
  let titlePageGroup = null;

  sections.forEach((section, index) => {
    const sectionEl = document.createElement("section");
    sectionEl.className = "text-section";
    const level = section.level || 1;
    sectionEl.classList.add(`section-level-${level}`);
    if (section.isTitlePage) {
      sectionEl.classList.add("titlepage-section");
      const prev = sections[index - 1];
      const next = sections[index + 1];
      if (!prev || !prev.isTitlePage) {
        sectionEl.classList.add("titlepage-start");
      }
      if (!next || !next.isTitlePage) {
        sectionEl.classList.add("titlepage-end");
      }
    }
    sectionEl.id = section.id;

    const content = document.createElement("div");
    content.className = "section-content";

    section.entries.forEach((entry) => {
      const built = buildEntry(entry, state);
      content.appendChild(built.wrapper);
      pageMarkerLayouts.push(built);
    });
    sectionEl.appendChild(content);
    if (section.isTitlePage) {
      if (!titlePageGroup) {
        titlePageGroup = document.createElement("div");
        titlePageGroup.className = "titlepage-group";
        textGrid.appendChild(titlePageGroup);
      }
      titlePageGroup.appendChild(sectionEl);
    } else {
      titlePageGroup = null;
      textGrid.appendChild(sectionEl);
    }
  });

  buildToc(sections);
  scheduleRelayout();
  RELAYOUT_SETTLE_DELAYS.forEach((delay) => {
    window.setTimeout(scheduleRelayout, delay);
  });

  if (!resizeBound) {
    window.addEventListener("resize", () => {
      scheduleRelayout();
    });
    window.addEventListener("load", () => {
      scheduleRelayout();
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        scheduleRelayout();
      });
    }
    resizeBound = true;
  }
}

function setSourceStatus(message) {
  if (!sourceStatus) return;
  sourceStatus.textContent = message;
}

function parseAndRender(xmlText) {
  try {
    if (!xmlText.trim()) {
      textGrid.innerHTML =
        "<p class='muted'>TEI-filen er tom eller kunne ikke leses.</p>";
      return false;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      textGrid.innerHTML = "<p class='muted'>Kunne ikke parse TEI-filen.</p>";
      return false;
    }
    const entries = buildEntries(doc);
    buildText(entries);
    return true;
  } catch (error) {
    textGrid.innerHTML =
      "<p class='muted'>Uventet feil ved parsing av TEI-filen.</p>";
    return false;
  }
}

function setupFilePicker() {
  if (!pickTeiBtn || !teiFileInput) return;
  pickTeiBtn.addEventListener("click", () => teiFileInput.click());
  teiFileInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setSourceStatus(`Laster: ${file.name}`);
    try {
      const xmlText = await file.text();
      const ok = parseAndRender(xmlText);
      setSourceStatus(
        ok
          ? `Viser lokal fil: ${file.name}`
          : `Kunne ikke lese filen: ${file.name}`
      );
    } catch (error) {
      textGrid.innerHTML = "<p class='muted'>Kunne ikke lese valgt TEI-fil.</p>";
      setSourceStatus("Kunne ikke lese valgt fil");
    }
  });
}

function setupAboutModal() {
  if (!aboutOpenBtn || !aboutCloseBtn || !aboutModal) return;
  // Ensure closed on page load, even if browser restores previous UI state.
  aboutModal.hidden = true;
  aboutModal.setAttribute("hidden", "");
  aboutModal.style.display = "none";
  const closeModal = () => {
    aboutModal.hidden = true;
    aboutModal.setAttribute("hidden", "");
    aboutModal.style.display = "none";
  };
  aboutOpenBtn.addEventListener("click", () => {
    aboutModal.hidden = false;
    aboutModal.removeAttribute("hidden");
    aboutModal.style.display = "grid";
  });
  aboutCloseBtn.addEventListener("click", closeModal);
  aboutModal.addEventListener("click", (event) => {
    if (event.target === aboutModal) closeModal();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !aboutModal.hidden) {
      closeModal();
    }
  });
}

async function tryLoadDefaultTei() {
  try {
    const response = await fetch(TEI_PATH);
    if (!response.ok) return false;
    const xmlText = await response.text();
    const ok = parseAndRender(xmlText);
    if (ok) {
      setSourceStatus(`Viser standardfil: ${TEI_PATH}`);
    }
    return ok;
  } catch (error) {
    return false;
  }
}

async function init() {
  // Works both serverless (file:// via "Velg TEI-fil") and with local/static hosting.
  const serverlessMode = window.location.protocol === "file:";
  if (sourceControls) {
    sourceControls.hidden = !serverlessMode;
  }
  setupAboutModal();
  setupFilePicker();
  const loadedDefault = await tryLoadDefaultTei();
  if (!loadedDefault) {
    textGrid.innerHTML =
      "<p class='muted'>Fant ikke TEI automatisk. Klikk \"Velg TEI-fil\" for å åpne en XML-fil.</p>";
    setSourceStatus("Ingen standardfil lastet. Velg TEI-fil manuelt.");
  }
}

init();

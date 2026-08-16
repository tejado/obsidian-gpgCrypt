/**
 * Polyfills for the DOM helper methods that Obsidian adds to `HTMLElement.prototype`
 * (and friends) at runtime — happy-dom/jsdom do not have them. Only what the plugin sources use
 * (plus a few obvious siblings) is implemented; semantics follow Obsidian's `obsidian.d.ts`
 * (`DomElementInfo`: cls / text / attr / title / value / type / placeholder / href / parent / prepend).
 *
 * Loaded as a Vitest `setupFiles` entry for the DOM projects (component, integration; happy-dom).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- prototype patching needs loose function types */

type AnyFn = (...args: any[]) => any;

type DomElementInfo = {
	cls?: string | string[];
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	value?: string;
	type?: string;
	placeholder?: string;
	href?: string;
	parent?: Node;
	prepend?: boolean;
};

function applyInfo(el: Element, info?: string | DomElementInfo): void {
	if (info === undefined || info === null) return;
	if (typeof info === "string") {
		if (info) el.className = info;
		return;
	}
	if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
	if (info.text !== undefined) {
		if (typeof info.text === "string") el.textContent = info.text;
		else el.appendChild(info.text);
	}
	if (info.title !== undefined) el.setAttribute("title", info.title);
	if (info.type !== undefined) (el as HTMLInputElement).type = info.type;
	if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
	if (info.placeholder !== undefined) (el as HTMLInputElement).placeholder = info.placeholder;
	if (info.href !== undefined) el.setAttribute("href", info.href);
	if (info.attr) {
		for (const [k, v] of Object.entries(info.attr)) {
			if (v === null || v === false) el.removeAttribute(k);
			else el.setAttribute(k, String(v));
		}
	}
}

function define(proto: object, name: string, value: unknown): void {
	if (Object.prototype.hasOwnProperty.call(proto, name)) return;
	Object.defineProperty(proto, name, { value, configurable: true, writable: true, enumerable: false });
}

export function installObsidianDomPolyfills(): void {
	const nodeProtos: object[] = [Node.prototype];
	const elementProtos: object[] = [Element.prototype];

	for (const proto of nodeProtos) {
		define(proto, "createEl", function (this: Node, tag: string, info?: string | DomElementInfo, callback?: (el: HTMLElement) => void) {
			const el = document.createElement(tag);
			applyInfo(el, info);
			const target = (typeof info === "object" && info?.parent) || this;
			if (typeof info === "object" && info?.prepend) target.insertBefore(el, target.firstChild);
			else target.appendChild(el);
			callback?.(el);
			return el;
		});
		define(proto, "createDiv", function (this: Node & { createEl: AnyFn }, info?: string | DomElementInfo, callback?: (el: HTMLElement) => void) {
			return this.createEl("div", info, callback);
		});
		define(proto, "createSpan", function (this: Node & { createEl: AnyFn }, info?: string | DomElementInfo, callback?: (el: HTMLElement) => void) {
			return this.createEl("span", info, callback);
		});
		define(proto, "createSvg", function (this: Node, tag: string, info?: string | DomElementInfo, callback?: (el: SVGElement) => void) {
			const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
			applyInfo(el, info);
			this.appendChild(el);
			callback?.(el);
			return el;
		});
		define(proto, "empty", function (this: Node) {
			while (this.firstChild) this.removeChild(this.firstChild);
		});
		define(proto, "detach", function (this: Node) {
			this.parentNode?.removeChild(this);
		});
		define(proto, "appendText", function (this: Node, text: string) {
			this.appendChild(document.createTextNode(text));
		});
		define(proto, "setText", function (this: Node & { empty: AnyFn }, text: string | DocumentFragment) {
			if (typeof text === "string") this.textContent = text;
			else {
				this.empty();
				this.appendChild(text);
			}
		});
		define(proto, "insertAfter", function (this: Node, node: Node, child: Node | null) {
			this.insertBefore(node, child ? child.nextSibling : this.firstChild);
			return node;
		});
	}

	for (const proto of elementProtos) {
		define(proto, "addClass", function (this: Element, ...classes: (string | string[])[]) {
			this.classList.add(...classes.flat());
		});
		define(proto, "addClasses", function (this: Element, classes: string[]) {
			this.classList.add(...classes);
		});
		define(proto, "removeClass", function (this: Element, ...classes: (string | string[])[]) {
			this.classList.remove(...classes.flat());
		});
		define(proto, "removeClasses", function (this: Element, classes: string[]) {
			this.classList.remove(...classes);
		});
		define(proto, "toggleClass", function (this: Element, classes: string | string[], value: boolean) {
			for (const c of [classes].flat()) this.classList.toggle(c, value);
		});
		define(proto, "hasClass", function (this: Element, cls: string) {
			return this.classList.contains(cls);
		});
		define(proto, "setAttr", function (this: Element, qualifiedName: string, value: string | number | boolean | null) {
			if (value === null || value === false) this.removeAttribute(qualifiedName);
			else this.setAttribute(qualifiedName, String(value));
		});
		define(proto, "setAttrs", function (this: Element & { setAttr: AnyFn }, obj: Record<string, string | number | boolean | null>) {
			for (const [k, v] of Object.entries(obj)) this.setAttr(k, v);
		});
		define(proto, "getAttr", function (this: Element, qualifiedName: string) {
			return this.getAttribute(qualifiedName);
		});
		define(proto, "matchParent", function (this: Element, selector: string, lastParent?: Element) {
			// eslint-disable-next-line @typescript-eslint/no-this-alias -- walking up from the element itself
			let cur: Element | null = this;
			while (cur && cur !== lastParent) {
				if (cur.matches(selector)) return cur;
				cur = cur.parentElement;
			}
			return null;
		});
	}

	// HTMLElement-only helpers (style based)
	define(HTMLElement.prototype, "show", function (this: HTMLElement) {
		this.style.display = "";
	});
	define(HTMLElement.prototype, "hide", function (this: HTMLElement) {
		this.style.display = "none";
	});
	define(HTMLElement.prototype, "toggle", function (this: HTMLElement, show: boolean) {
		this.style.display = show ? "" : "none";
	});
	define(HTMLElement.prototype, "toggleVisibility", function (this: HTMLElement, visible: boolean) {
		this.style.visibility = visible ? "" : "hidden";
	});
	define(HTMLElement.prototype, "isShown", function (this: HTMLElement) {
		return this.style.display !== "none";
	});
	define(HTMLElement.prototype, "setCssStyles", function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
		Object.assign(this.style, styles);
	});
	define(HTMLElement.prototype, "setCssProps", function (this: HTMLElement, props: Record<string, string>) {
		for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
	});
	define(HTMLElement.prototype, "onClickEvent", function (this: HTMLElement, listener: (ev: MouseEvent) => void) {
		this.addEventListener("click", listener);
	});
	define(HTMLElement.prototype, "trigger", function (this: HTMLElement, eventType: string) {
		this.dispatchEvent(new Event(eventType, { bubbles: true }));
	});

	// jsdom gaps used by the plugin: `innerText` (SettingsTab.ts) and `ariaLabel` (main.ts statusBarRefresh)
	if (!("innerText" in HTMLElement.prototype)) {
		Object.defineProperty(HTMLElement.prototype, "innerText", {
			configurable: true,
			get(this: HTMLElement) {
				return this.textContent ?? "";
			},
			set(this: HTMLElement, v: string) {
				this.textContent = v;
			},
		});
	}
	if (!("ariaLabel" in Element.prototype)) {
		Object.defineProperty(Element.prototype, "ariaLabel", {
			configurable: true,
			get(this: Element) {
				return this.getAttribute("aria-label");
			},
			set(this: Element, v: string | null) {
				if (v === null) this.removeAttribute("aria-label");
				else this.setAttribute("aria-label", v);
			},
		});
	}

	// Global element factories (Obsidian exposes these on window)
	const g = globalThis as Record<string, unknown>;
	g.createEl ??= (tag: string, info?: string | DomElementInfo, cb?: (el: HTMLElement) => void) =>
		(document.body as unknown as { createEl: AnyFn }).createEl(tag, info, cb);
	g.createDiv ??= (info?: string | DomElementInfo, cb?: (el: HTMLElement) => void) =>
		(document.body as unknown as { createDiv: AnyFn }).createDiv(info, cb);
	g.createSpan ??= (info?: string | DomElementInfo, cb?: (el: HTMLElement) => void) =>
		(document.body as unknown as { createSpan: AnyFn }).createSpan(info, cb);
	g.createFragment ??= (cb?: (frag: DocumentFragment) => void) => {
		const frag = document.createDocumentFragment();
		cb?.(frag);
		return frag;
	};
	g.activeWindow ??= globalThis;
	g.activeDocument ??= document;
	g.sleep ??= (ms: number) => new Promise((r) => setTimeout(r, ms));
	g.nextFrame ??= () => new Promise((r) => setTimeout(r, 0));
}

installObsidianDomPolyfills();

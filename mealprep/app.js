// 화면. 계산은 logic.js(Mealprep.plan), 데이터는 data/*.json, 글자는 i18n/*.json.
const $ = s => document.querySelector(s);
const KEY = "mealprep-v1";
// pick: 고른 재료(가진 재료·뺄 재료), adj: 메뉴 바꾸기·빼기 상태
let T, prices, recipes, lang, seed = 0, checks = {}, last = null, tab = "menu", history = [];
let pick = { have: [], ban: [] }, adj = { pin: [], skip: [], count: 0 }, more = { have: false, ban: false };
const SUGGEST = {
  have: ["egg", "tofu", "onion", "chickenbreast", "kimchi", "potato", "sweetpotato", "porkshoulder", "carrot", "tuna", "broccoli", "cabbage"],
  ban: ["onion", "kimchi", "squid", "mackerel", "tofu", "porkshoulder", "beefround", "chickenbreast", "eggplant", "greenonion"],
};
// 흔히 쓰는 다른 이름 → 재료 id
const ALIAS = { 계란: "egg", 달걀: "egg", 파: "greenonion", 마늘: "garlic", 닭: "chicken", 닭고기: "chicken", 돼지: "porkshoulder", 돼지고기: "porkshoulder",
  목살: "porkneck", 소고기: "beefround", 쇠고기: "beefround", 밥: "rice", 햇반: "instantrice", 버섯: "kingoyster", 참치: "tuna", 고추: "greenchili",
  배추: "napa", 콩: "beans", eggs: "egg", rice: "rice", chicken: "chicken", pork: "porkshoulder", beef: "beefround", mushroom: "kingoyster", 卵: "egg" };

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ lang, seed, checks, tab, pick, adj, history, opt: readForm(), shown: !!last })); } catch {} };
const getJSON = p => window.INLINE?.[p] ? Promise.resolve(window.INLINE[p]) : fetch(p).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
const tr = (key, vars = {}) => key.split(".").reduce((o, k) => o?.[k], T)?.replace(/\{(\w+)\}/g, (_, v) => vars[v]) ?? key;
const L = o => o?.[lang] || o?.ko || "";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const item = id => prices.items.find(p => p.id === id);

function won(n) {
  const v = Math.round(n / 10) * 10;
  return lang === "ko" ? v.toLocaleString("ko-KR") + "원" : "₩" + v.toLocaleString("en-US");
}
function amount(n, unit) {
  if (unit === "g") return n >= 1000 ? +(n / 1000).toFixed(1) + "kg" : Math.ceil(n) + "g";
  return +n.toFixed(1) + tr("unit.개");
}

// "양파, 두부 계란" 같은 글을 재료 id 로. 못 찾은 말은 따로 돌려준다.
function matchIngredients(text) {
  const found = [], miss = [];
  for (const tok of text.split(/[,，、·/\s]+/).map(t => t.trim()).filter(Boolean)) {
    const t = tok.toLowerCase();
    const names = p => [p.name.ko.replace(/\(.*?\)/g, "").replace(/\s/g, ""), p.name.en.toLowerCase(), p.name.ja];
    let id = ALIAS[t] || prices.items.find(p => names(p).includes(t))?.id;
    if (!id && t.length >= 2) {
      const hits = prices.items.filter(p => names(p).some(n => n.includes(t) || t.includes(n)));
      id = hits.sort((a, b) => a.name.ko.length - b.name.ko.length)[0]?.id;
    }
    id ? found.push(id) : miss.push(tok);
  }
  return { found, miss };
}

function options(sel, from, to, unit) {
  sel.innerHTML = "";
  for (let i = from; i <= to; i++) sel.add(new Option(i + (unit ? " " + unit : ""), i));
}

function buildForm(opt) {
  const goals = opt.goals || [opt.goal || "budget"];
  $("#goals").innerHTML = Mealprep.GOALS.map(g =>
    `<label><input type="checkbox" name="goal" value="${g}" ${goals.includes(g) ? "checked" : ""}><span>${tr("goals." + g)}</span></label>`).join("");
  const used = [...new Set(prices.items.flatMap(p => p.allergens))];
  $("#exclude").innerHTML = used.map(a =>
    `<label><input type="checkbox" name="exclude" value="${a}"><span>${tr("allergen." + a)}</span></label>`).join("");
  const f = $("#form");
  options(f.people, 1, 6, tr("unitPeople"));
  options(f.days, 1, 7, tr("unitDays"));
  options(f.perDay, 1, 3, tr("unitMeals"));
  f.people.value = opt.people || 1;
  f.days.value = opt.days || 5;
  f.perDay.value = opt.perDay || 1;
  f.budget.value = Math.min(10000, Math.max(2000, opt.budget || 4000));
  for (const c of f.querySelectorAll("[name=exclude]")) c.checked = (opt.exclude || []).includes(c.value);
  $("#skipPantry").checked = opt.skipPantry !== false;
  renderPickers();
  // 입력칸 자동완성: 재료 이름 전부
  $("#ingList").innerHTML = prices.items.map(p => `<option value="${esc(L(p.name).replace(/\(.*?\)/g, ""))}">`).join("");
}

// 재료 고르기: 고른 것(✕로 빼기) + 추천(+로 넣기). 가진 재료와 뺄 재료는 서로 겹치지 않게.
function renderPickers() {
  for (const kind of ["have", "ban"]) {
    const other = kind === "have" ? "ban" : "have";
    const sel = pick[kind].map(id => `<button type="button" class="pk on" data-kind="${kind}" data-id="${id}" aria-label="${esc(tr("remove"))} ${esc(L(item(id).name))}">${esc(L(item(id).name))} ✕</button>`);
    const all = SUGGEST[kind].filter(id => !pick[kind].includes(id) && !pick[other].includes(id));
    const sug = (more[kind] ? all : all.slice(0, 6))  // 첫 화면이 길어지지 않게 추천은 6개만, 나머지는 더 보기
      .map(id => `<button type="button" class="pk" data-kind="${kind}" data-id="${id}">+ ${esc(L(item(id).name))}</button>`);
    if (all.length > 6) sug.push(`<button type="button" class="pk more" data-more="${kind}">${tr(more[kind] ? "less" : "moreChips")}</button>`);
    $(`#${kind}Chips`).innerHTML = sel.concat(sug).join("");
  }
}

function addTyped(kind) {
  const input = $(`#${kind}Input`);
  const { found, miss } = matchIngredients(input.value);
  const other = kind === "have" ? "ban" : "have";
  for (const id of found) {
    if (!pick[kind].includes(id)) pick[kind].push(id);
    pick[other] = pick[other].filter(x => x !== id);
  }
  $(`#${kind}Miss`).hidden = !miss.length;
  $(`#${kind}Miss`).textContent = tr("notFound", { names: miss.join(", ") });
  input.value = "";
  renderPickers();
  updateForm();
  save();
}

function readForm() {
  const f = $("#form");
  if (!f.budget) return {};
  const clamp = (v, a, b, d) => Math.min(b, Math.max(a, Number(v) || d));
  const goals = [...f.querySelectorAll("[name=goal]:checked")].map(c => c.value);
  return {
    goals: goals.length ? goals : ["budget"],
    people: clamp(f.people.value, 1, 6, 1),
    days: clamp(f.days.value, 1, 7, 5),
    perDay: clamp(f.perDay.value, 1, 3, 1),
    budget: clamp(f.budget.value, 2000, 10000, 4000),
    exclude: [...f.querySelectorAll("[name=exclude]:checked")].map(c => c.value),
    have: pick.have.slice(),
    ban: pick.ban.slice(),
    skipPantry: $("#skipPantry").checked,
  };
}

function translateStatic() {
  document.documentElement.lang = lang;
  document.title = tr("title");
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = tr(el.dataset.t);
  for (const el of document.querySelectorAll("[data-ph]")) el.placeholder = tr(el.dataset.ph);
  $("#priceNote").textContent = tr("priceNote", { date: prices.asOf });
  $("#notesShort").textContent = tr("notesShort", { date: prices.asOf });
  updateForm();
}

// 예산 슬라이더·접힌 설정 요약을 바로 반영 (첫 화면 궁금증 문장도 예산을 따라 바뀜)
function updateForm() {
  const o = readForm();
  const n = o.exclude.length + o.ban.length;
  $("#hook").textContent = tr("hook", { budget: won(o.budget) });
  $("#budgetOut").textContent = won(o.budget);
  $("#moreSum").textContent = tr("moreSum", { people: o.people, days: o.days, perDay: o.perDay,
    ex: n ? tr("exSome", { n }) : tr("exNone") });
}

function setCollapsed(on) {
  const o = readForm();
  $("#hero").hidden = $("#form").hidden = on;
  $("#planBar").hidden = !on;
  $("#planSum").textContent = [o.goals.map(g => tr("goals." + g)).join(" "),
    tr("moreSum", { people: o.people, days: o.days, perDay: o.perDay, ex: "" }).replace(/ · *▾$/, ""),
    tr("budget") + " " + won(o.budget)].join(" · ");
}

function showTab(name) {
  tab = name;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", b.dataset.tab === name);
  for (const t of ["menu", "shop", "steps"]) $("#panel-" + t).hidden = t !== name;
}

function updateProgress() {
  const rows = [...document.querySelectorAll("#shop input[type=checkbox]")];
  const done = rows.filter(c => c.checked).length;
  $("#progressText").textContent = tr("progress", { done, total: rows.length });
  $("#progressBar").style.width = (rows.length ? done / rows.length * 100 : 0) + "%";
  $("#allDone").hidden = !rows.length || done < rows.length;
  $("#tab-shop").textContent = tr("tabShop", { done, total: rows.length });
}

function recipeHtml(m) {
  const r = m.r;
  const ing = r.ing.map(i => {
    const p = item(i.id);
    return `<li><span>${esc(L(p.name))}${pick.have.includes(i.id) ? ` <span class="tag est">${tr("haveShort")}</span>` : ""}</span>
      <span class="q">${amount(i.qty, p.unit)} <span class="amt">· ${amount(i.qty * m.servings, p.unit)}</span></span></li>`;
  }).join("");
  return `<details class="recipe"><summary>${tr("recipe")}</summary>
    <p class="label">${tr("recipeIng", { n: m.servings })}</p><ul class="ingl">${ing}</ul>
    <p class="label">${tr("recipeSteps", { n: r.minutes })}</p>
    <ol class="rsteps">${r.steps.map(s => `<li>${esc(L(s.text))}</li>`).join("")}</ol></details>`;
}

function render() {
  const opt = readForm();
  const p = last = Mealprep.plan({ ...opt, ...adj, recent: history.flat() }, recipes, prices, seed);
  const tags = a => a.map(x => `<span class="tag">${esc(tr("allergen." + x))}</span>`).join("");

  $("#result").hidden = false;
  setCollapsed(true);
  $(".tabs").hidden = p.empty;
  if (p.empty) {
    $("#summary").className = "card summary over";
    $("#summary").innerHTML = `<p class="praise">${tr("emptyTitle")}</p><p class="meta">${tr("emptyHint")}</p>
      <button type="button" class="primary" id="emptyEdit">${tr("edit")}</button>`;
    for (const t of ["menu", "shop", "steps"]) $("#panel-" + t).hidden = true;
    $("#emptyEdit").onclick = () => $("#edit").click();
    save();
    return;
  }

  $("#menu").innerHTML = p.menu.map(m => `<li data-id="${m.r.id}">
    <b class="mname">${esc(L(m.r.name))}</b>
    <span class="meta">${tr("servings", { n: m.servings })} · <b class="cost">${tr("perServing", { cost: won(m.cost) })}</b> · ${tr("minutes", { n: m.r.minutes })} · ${tr("keep", { n: m.r.keepDays })}</span>
    <div><span class="tag est">${tr("aiBadge")}</span>${m.haveHit ? `<span class="tag est">${tr("haveTag", { n: m.haveHit })}</span>` : ""}${tags(m.allergens)}</div>
    ${recipeHtml(m)}
    <div class="acts"><button type="button" data-act="swap">${tr("swap")}</button><button type="button" data-act="drop" ${p.menu.length < 2 ? "disabled" : ""}>${tr("drop")}</button></div></li>`).join("");

  const buy = key => {
    const u = buyLink(key);
    return u ? `<a class="buy" href="${esc(u)}" data-key="${esc(key)}" target="_blank" rel="noopener sponsored">${tr("buy")}</a><span class="tag">${tr("adTag")}</span>` : "";
  };
  const row = x => {
    const id = x.item.id;
    return `<li class="${checks[id] ? "done" : ""}">
      <label class="hit"><input type="checkbox" data-id="${id}" ${checks[id] ? "checked" : ""}>
      <span><span class="name">${esc(L(x.item.name))}</span>${x.item.src === "est" ? ` <span class="tag est">${tr("est")}</span>` : ""}
        <br><span class="amt">${x.have ? "" : `${tr("buyAmt")} ${amount(x.buy, x.item.unit)} · `}${tr("need")} ${amount(x.need, x.item.unit)} · <span title="${esc(x.uses.map(r => L(r.name)).join(", "))}">${tr("usedIn", { n: x.uses.length })}</span></span></span></label>
      <span class="right">${x.have ? tr("haveShort") : won(x.buyCost)}</span>${buy(id) && `<span class="buyrow">${buy(id)}</span>`}</li>`;
  };
  const fresh = p.shop.filter(x => !x.have && !x.item.pantry), pantry = p.shop.filter(x => !x.have && x.item.pantry), have = p.shop.filter(x => x.have);
  $("#shop").innerHTML = fresh.map(row).join("")
    + (pantry.length ? `<li class="group">${tr("pantry")} — ${tr("pantryHint")}</li>` + pantry.map(row).join("") : "")
    + (have.length ? `<li class="group">${tr("haveGroup")}</li>` + have.map(row).join("") : "");

  const gear = ["gear-container", "gear-lunchbox", "gear-scale"].filter(buyLink);
  $("#gear").innerHTML = gear.map(k => `<li><span class="hit name">${tr("gears." + k)}</span><span class="right">${buy(k)}</span></li>`).join("");
  $("#gearCard").hidden = !gear.length;
  $("#affiliate").hidden = !document.querySelector("#result a.buy");
  $("#ad").hidden = !ADS_ON;

  // 예산 기준 = 이번에 실제로 사는 돈(포장 단위). 남는 재료는 다음 주로.
  const t = p.totals;
  const leftover = p.shop.filter(x => !x.have && !(opt.skipPantry && x.item.pantry)).reduce((s, x) => s + x.buyCost - x.usedCost, 0);
  $("#summary").className = "card summary" + (p.overBudget ? " over" : "");
  // 도시락 캐릭터: 예산 안이면 웃고, 넘으면 땀
  const face = p.overBudget
    ? '<circle cx="25" cy="38" r="3"/><circle cx="39" cy="38" r="3"/><path d="M26 47h12" stroke="#1d2a24" stroke-width="3" stroke-linecap="round"/><path d="M48 26q3 5 0 8q-3-3 0-8z" fill="#7cc4f2"/>'
    : '<path d="M21 38q4-5 8 0M35 38q4-5 8 0" fill="none" stroke="#1d2a24" stroke-width="3" stroke-linecap="round"/><path d="M25 45q7 7 14 0" fill="none" stroke="#1d2a24" stroke-width="3" stroke-linecap="round"/><circle cx="17" cy="44" r="3" fill="#f6a5a5"/><circle cx="47" cy="44" r="3" fill="#f6a5a5"/>';
  const mascot = `<svg class="mascot" viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="12" width="44" height="8" rx="4" fill="#bfe6d2"/><rect x="6" y="20" width="52" height="38" rx="12" fill="#1f7a52"/><rect x="10" y="24" width="44" height="30" rx="9" fill="#fff"/><g fill="#1d2a24">${face}</g></svg>`;
  $("#summary").innerHTML = `${mascot}<p class="praise">${p.overBudget ? tr("overTitle") : tr("praise")}</p>
    <p class="big">${tr("shopTotal", { won: won(t.buy) })} <span class="of">${tr("budgetOf", { won: won(t.limit) })}</span></p>
    <span class="bar budgetbar"><i style="width:${Math.min(100, t.buy / t.limit * 100).toFixed(1)}%"></i></span>
    <p class="meta ${p.overBudget ? "warn" : ""}">${p.overBudget ? tr("overBy", { won: won(p.overBy) }) + " " + tr("overHint") : tr("underBy", { won: won(t.limit - t.buy) })}</p>
    ${p.haveUsed ? `<p class="meta">${tr("haveSummary", { n: p.haveUsed })}</p>` : ""}
    <p class="meta">${tr("eatPerMeal", { meals: p.meals, won: won(t.perMeal), left: won(leftover) })}</p>
    ${opt.skipPantry ? `<p class="meta">${tr("pantryOut")}</p>` : ""}`;
  $("#tab-menu").textContent = tr("tabMenu", { n: p.menu.length });
  $("#tab-steps").textContent = tr("tabSteps");
  updateProgress();

  $("#steps").innerHTML = p.steps.map((s, i) => `<li><b><span class="num">${i + 1}</span>${tr("stages." + s.stage)}</b><ul>${
    s.items.map(i => `<li><span class="who">${esc(L(i.r.name))}</span> ${esc(L(i.text))}</li>`).join("")}</ul></li>`).join("");

  showTab(tab);
  save();
}

// 메뉴 하나 바꾸기·빼기: 나머지는 그대로 두고(pin) 그 메뉴는 다시 안 고름(skip)
function editMenu(id, act) {
  const ids = last.menu.map(m => m.r.id);
  const pin = act === "drop" ? ids.filter(x => x !== id) : ids.map(x => (x === id ? null : x));
  adj = { pin, skip: [...new Set([...adj.skip, id])], count: pin.length };
  checks = {};
  render();
}

function shareText() {
  const lines = [`${tr("title")} — ${tr("shop")}`];
  for (const x of last.shop) {
    if (x.have || ($("#skipPantry").checked && x.item.pantry)) continue;
    lines.push(`${checks[x.item.id] ? "☑" : "☐"} ${L(x.item.name)} ${amount(x.buy, x.item.unit)} (${won(x.buyCost)})`);
  }
  lines.push(`${tr("costBuy")}: ${won(last.totals.buy)}`, tr("priceNote", { date: prices.asOf }));
  return lines.join("\n");
}

async function share() {
  const text = shareText();
  if (window.MP_SHARE) return window.MP_SHARE(text); // 토스판: Share.sendMessage
  try {
    if (navigator.share) return await navigator.share({ title: tr("shop"), text });
  } catch (e) { if (e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); alert(tr("copied")); } catch { prompt("", text); }
}

async function start() {
  const st = load();
  lang = st.lang || (["en", "ja"].includes(navigator.language.slice(0, 2)) ? navigator.language.slice(0, 2) : "ko");
  seed = st.seed || 0;
  checks = st.checks || {};
  tab = st.tab || "menu";
  history = Array.isArray(st.history) ? st.history.slice(-3) : [];
  pick = { have: st.pick?.have || [], ban: st.pick?.ban || [] };
  adj = { pin: [], skip: [], count: 0, ...st.adj };
  [prices, recipes, T] = await Promise.all([getJSON("data/prices.json"), getJSON("data/recipes.json"), getJSON(`i18n/${lang}.json`)]);
  const known = new Set(prices.items.map(p => p.id));
  pick.have = pick.have.filter(id => known.has(id));
  pick.ban = pick.ban.filter(id => known.has(id));
  $("#lang").value = lang;
  buildForm(st.opt || {});
  translateStatic();
  if (st.shown) render();

  $("#form").addEventListener("submit", e => {
    e.preventDefault(); checks = {}; tab = "menu"; adj = { pin: [], skip: [], count: 0 };
    if (last && !last.empty) history = [...history, last.menu.map(m => m.r.id)].slice(-3); // 지난 계획 3번까지 기억해서 다음엔 다른 메뉴
    $("#more").open = false; render(); $("#summary").scrollIntoView({ behavior: "smooth" });
  });
  $("#form").addEventListener("input", updateForm);
  $("#form").addEventListener("change", updateForm);
  $("#form").addEventListener("click", e => {
    const b = e.target.closest(".pk");
    if (!b) return;
    if (b.dataset.more) { more[b.dataset.more] = !more[b.dataset.more]; renderPickers(); return; }
    const { kind, id } = b.dataset;
    pick[kind] = pick[kind].includes(id) ? pick[kind].filter(x => x !== id) : [...pick[kind], id];
    renderPickers(); updateForm(); save();
  });
  for (const kind of ["have", "ban"]) {
    $(`#${kind}Add`).addEventListener("click", () => addTyped(kind));
    $(`#${kind}Input`).addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addTyped(kind); } });
  }
  $("#edit").addEventListener("click", () => { setCollapsed(false); $("#form").scrollIntoView({ behavior: "smooth" }); });
  for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => { showTab(b.dataset.tab); save(); });
  $("#again").addEventListener("click", () => { seed++; checks = {}; adj = { pin: [], skip: [], count: 0, avoid: last.menu.map(m => m.r.id) }; render(); });
  $("#menu").addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (b) editMenu(b.closest("li[data-id]").dataset.id, b.dataset.act);
  });
  $("#skipPantry").addEventListener("change", render);
  // 쿠팡 링크 누름 기록: 재료 id·위치만(개인정보 없음). 토스판에서만 Analytics.log 로 보내고 웹판은 아무것도 안 보냄
  $("#result").addEventListener("click", e => {
    const a = e.target.closest("a.buy");
    if (a) window.MP_LOG?.("coupang_click", { item: a.dataset.key, place: a.closest("#gear") ? "gear" : "shop" });
  });
  $("#share").addEventListener("click", share);
  $("#copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(shareText()); $("#copy").textContent = tr("copied"); setTimeout(() => ($("#copy").textContent = tr("copy")), 1500); }
    catch { prompt("", shareText()); }
  });
  $("#shop").addEventListener("change", e => {
    const id = e.target.dataset.id;
    if (!id) return;
    checks[id] = e.target.checked;
    e.target.closest("li").classList.toggle("done", e.target.checked);
    updateProgress();
    save();
  });
  $("#lang").addEventListener("change", async e => {
    const opt = readForm();
    lang = e.target.value;
    T = await getJSON(`i18n/${lang}.json`);
    buildForm(opt);
    translateStatic();
    if (last) render(); else save();
  });
}

start().catch(e => {
  console.warn(e);
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="verdict" role="alert">${T?.loadError || "불러오지 못했어요. 새로고침해 주세요."}</p>`);
});
if ("serviceWorker" in navigator && location.protocol !== "file:" && !window.INLINE) navigator.serviceWorker.register("sw.js");

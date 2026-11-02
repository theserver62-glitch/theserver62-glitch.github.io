// 밀프렙 계산 규칙 (브라우저·node 같이 씀). AI 호출 없음: recipes.json + prices.json 만으로 조합한다.
(function (root) {
  const STAGES = ["prep", "grain", "oven", "boil", "pan", "mix", "pack"];
  const GOALS = ["diet", "muscle", "budget", "easy"];

  // 주재료가 아닌 것(밥·양념): 한 주에 여러 번 써도 괜찮음
  const BASE = new Set(["rice", "brownrice", "barley", "mixgrain", "instantrice", "oats", "oil", "sesameoil", "sugar", "salt", "pepper",
    "garlic", "greenonion", "soysauce", "gochujang", "gochugaru", "doenjang", "oystersauce", "sesame", "curry", "kimchi"]);
  const mainIng = r => r.ing.map(i => i.id).filter(id => !BASE.has(id));
  const byId = prices => Object.fromEntries(prices.items.map(p => [p.id, p]));
  const unitPrice = p => p.price / p.per;
  const recipeCost = (r, pm) => r.ing.reduce((s, i) => s + i.qty * unitPrice(pm[i.id]), 0);
  const allergensOf = (r, pm) => [...new Set(r.ing.flatMap(i => pm[i.id].allergens))];

  // 같은 seed면 같은 결과. "다른 메뉴" 버튼은 seed만 바꾼다.
  function jitter(id, seed) {
    let h = seed * 2654435761;
    for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return ((h >>> 0) % 1000) / 1000;
  }

  function menuCount(meals) {
    return meals >= 10 ? 5 : Math.min(4, meals);
  }

  // 메뉴 목록 → 인분 나누기, 장보기(포장 단위 올림), 쓰는 양 재료비, 장볼 돈
  function shopFor(chosen, meals, pm, opt) {
    const have = opt.have || [];
    const base = Math.floor(meals / chosen.length), rem = meals % chosen.length;
    const menu = chosen.map((r, i) => ({ r, servings: base + (i < rem ? 1 : 0) }));
    const need = {}, uses = {};
    for (const m of menu) for (const i of m.r.ing) {
      need[i.id] = (need[i.id] || 0) + i.qty * m.servings;
      (uses[i.id] = uses[i.id] || []).push(m.r);
    }
    const shop = Object.entries(need).map(([id, n]) => {
      const p = pm[id];
      const buy = Math.ceil(n / p.buy - 1e-9) * p.buy; // 흔한 포장 단위로 올림
      return { item: p, need: n, buy, uses: uses[id], have: have.includes(id), usedCost: n * unitPrice(p), buyCost: buy * unitPrice(p) };
    });
    const used = shop.reduce((s, x) => s + x.usedCost, 0);
    const buy = shop.filter(x => !x.have && !(opt.skipPantry && x.item.pantry)).reduce((s, x) => s + x.buyCost, 0);
    return { menu, shop, used, buy };
  }

  // 목표(여러 개)·예산·알레르기·뺄 재료·가진 재료로 메뉴를 고른다.
  // 예산 기준은 '이번에 실제로 사는 돈'(포장 단위, 집에 있는 양념·쌀·가진 재료 빼고) ≤ 1끼 예산 × 끼니 수.
  // pin: 그대로 둘 메뉴 id(순서 유지), skip: 다시 안 고를 메뉴 id, count: 메뉴 수 직접 지정(바꾸기·빼기용)
  function pick(opt, recipes, pm, seed) {
    const goals = opt.goals?.length ? opt.goals : [opt.goal || "budget"];
    const have = opt.have || [], ban = opt.ban || [], skip = opt.skip || [], avoid = opt.avoid || [], recent = opt.recent || [];
    const ok = r => !skip.includes(r.id) && !r.ing.some(i => ban.includes(i.id))
      && !allergensOf(r, pm).some(a => opt.exclude.includes(a));
    const k = opt.count ? Math.max(1, Math.min(opt.count, 6, opt.meals)) : menuCount(opt.meals);
    const limit = opt.budget * opt.meals;
    // pin 의 null 은 "이 자리에 새 메뉴"(바꾸기한 자리를 그대로 지킴)
    const slots = (opt.pin || []).slice(0, k).map(id => recipes.find(r => r.id === id)).map(r => (r && ok(r) ? r : null));
    const fixed = new Set(slots.filter(Boolean));   // 사람이 남겨 둔 메뉴는 아래 예산 맞추기에서도 안 바꿈
    const left = recipes.filter(r => ok(r) && !slots.includes(r));
    const goalHit = r => r.goals.filter(g => goals.includes(g)).length;
    // 메뉴를 하나 더 넣을 때 장볼 돈이 얼마나 느나(이미 산 포장을 같이 쓰면 적게 늘어남)
    const buyOf = list => (list.length ? shopFor(list, opt.meals, pm, opt).buy : 0);
    const next = () => {
      const chosen = slots.filter(Boolean);
      const used = new Set(chosen.flatMap(mainIng));
      const proteins = chosen.map(r => r.protein);
      const nowBuy = buyOf(chosen);
      const share = limit / k;                        // 메뉴 한 자리 몫의 예산
      let best = 0, bestScore = Infinity;
      left.forEach((r, i) => {
        const cost = recipeCost(r, pm);
        const extra = Math.max(0, buyOf([...chosen, r]) - nowBuy);
        const onTrack = nowBuy + extra <= share * (chosen.length + 1);
        const repeat = mainIng(r).filter(id => used.has(id) && !have.includes(id)).length; // 같은 주에 같은 주재료 반복
        const haveHit = r.ing.filter(x => have.includes(x.id)).length;
        const score = (cost > opt.budget ? 100 + cost / opt.budget : 0)   // 1인분이 예산보다 비싼 메뉴는 억지로 안 넣음
          + 1.5 * extra / share + (onTrack ? 0 : 4)       // 장볼 돈: 예산 몫 안에서 덜 느는 메뉴 먼저
          + (goalHit(r) ? -0.5 * goalHit(r) : 50)         // 목표 맞는 메뉴 먼저
          - 2 * haveHit + (have.length && !haveHit ? 1 : 0) // 가진 재료를 쓰는 메뉴 먼저
          + (avoid.includes(r.id) ? 2 : 0)                // '다시 짜기': 방금 본 메뉴는 뒤로
          + (recent.includes(r.id) ? 6 : 0)               // 지난 몇 주에 먹은 메뉴는 뒤로(예산 몫 벌점 4보다 크게, 예산 맞추기에서만 되돌아옴)
          + (proteins.includes(r.protein) ? 3 : 0) + 0.6 * repeat + 1.5 * jitter(r.id, seed);
        if (score < bestScore) { bestScore = score; best = i; }
      });
      return left.splice(best, 1)[0];
    };
    slots.forEach((r, i) => { if (!r && left.length) slots[i] = next(); });
    while (slots.length < k && left.length) slots.push(next());
    let chosen = slots.filter(Boolean);

    // 예산 맞추기: 장볼 돈이 넘으면 메뉴 하나씩 바꿔 본다(목표가 맞는 메뉴로만). 그래도 넘으면 메뉴 수를 3개까지 줄여 본다.
    let buy = buyOf(chosen);
    // 예산 안으로 들어가는 바꾸기가 여럿이면 안 먹어 본(최근·방금 본 아닌) 메뉴를 고르고, 없으면 가장 많이 줄이는 바꾸기
    const stale = r => (recent.includes(r.id) ? 2.5 : 0) + (avoid.includes(r.id) ? 2 : 0) + jitter(r.id, seed);
    for (let round = 0; round < 12 && buy > limit; round++) {
      let fit = null, fitPref = Infinity, best = null, bestBuy = Infinity;
      const consider = list => {
        const b = buyOf(list);
        if (b <= limit) {
          const pref = list.reduce((x, r) => x + stale(r), 0);
          if (pref < fitPref) { fitPref = pref; fit = { list, b }; }
        } else {
          // 어떻게 해도 넘을 때(포장 단위가 끼니에 비해 너무 클 때)도 매주 똑같지 않게: 최근 메뉴엔 한도의 5%씩 벌점
          const sc = b + list.reduce((x, r) => x + stale(r), 0) * 0.05 * limit;
          if (b < buy - 1 && sc < bestBuy) { bestBuy = sc; best = { list, b }; }
        }
      };
      chosen.forEach((r, i) => {
        if (fixed.has(r)) return;
        for (const c of left) {
          if (recipeCost(c, pm) > opt.budget || (goalHit(r) && !goalHit(c))) continue;
          const list = chosen.slice(); list[i] = c;
          consider(list);
        }
      });
      if (!fit && !best && !opt.count && chosen.length > 3) {
        chosen.forEach((r, i) => { if (!fixed.has(r)) consider(chosen.filter((_, j) => j !== i)); });
      }
      const step = fit || best;
      if (!step) break;
      for (const r of chosen) if (!step.list.includes(r)) left.push(r);
      chosen = step.list; buy = step.b;
      for (const r of chosen) { const at = left.indexOf(r); if (at >= 0) left.splice(at, 1); }
    }
    return chosen;
  }

  // opt: {goals:[], people, days, perDay, budget(1끼 원), exclude:[알레르기], ban:[재료], have:[재료], pin, skip, count, skipPantry}
  function plan(opt, recipeData, prices, seed = 0) {
    const pm = byId(prices);
    const meals = opt.people * opt.days * opt.perDay;
    const limit = opt.budget * meals;
    // 입력이 바뀌면 고르는 순서도 바뀌게: seed 에 입력값 해시를 섞는다(같은 입력+같은 seed 면 같은 결과)
    const key = JSON.stringify([opt.goals || opt.goal, opt.budget, opt.people, opt.days, opt.perDay, opt.have, opt.ban, opt.exclude]);
    let h = 0;
    for (const c of key) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
    const chosen = pick({ ...opt, meals }, recipeData.recipes, pm, seed + (h >>> 0) % 100000);
    if (!chosen.length) return { meals, menu: [], shop: [], steps: [], totals: { used: 0, buy: 0, perMeal: 0, limit }, overBudget: false, overBy: 0, empty: true };
    const have = opt.have || [];
    const s = shopFor(chosen, meals, pm, opt);
    const menu = s.menu.map(m => ({ ...m, cost: recipeCost(m.r, pm), allergens: allergensOf(m.r, pm), haveHit: m.r.ing.filter(x => have.includes(x.id)).length }));
    const shop = s.shop.sort((a, b) => (a.have || a.item.pantry ? 1 : 0) - (b.have || b.item.pantry ? 1 : 0) || b.buyCost - a.buyCost);
    const steps = STAGES.map(stage => ({
      stage,
      items: menu.flatMap(m => m.r.steps.filter(x => x.stage === stage).map(x => ({ r: m.r, text: x.text }))),
    })).filter(x => x.items.length);
    const overBy = Math.max(0, s.buy - limit);
    return { meals, menu, shop, steps, totals: { used: s.used, buy: s.buy, perMeal: s.used / meals, limit }, overBudget: overBy > 0, overBy,
      haveUsed: shop.filter(x => x.have).length };
  }

  function selfTest() {
    const assert = (c, msg) => { if (!c) throw new Error("selfTest 실패: " + msg); };
    const prices = { items: [
      { id: "rice", unit: "g", price: 3000, per: 1000, buy: 1000, allergens: [], pantry: true },
      { id: "pork", unit: "g", price: 2000, per: 100, buy: 500, allergens: ["pork"] },
      { id: "egg", unit: "개", price: 400, per: 1, buy: 10, allergens: ["egg"] },
      { id: "tofu", unit: "g", price: 3000, per: 600, buy: 600, allergens: ["soy"] },
    ] };
    const R = (id, protein, ing, goals = ["diet"]) => ({ id, protein, goals, ing, steps: [{ stage: "pan", text: { ko: id } }] });
    const data = { recipes: [
      R("a", "pork", [{ id: "rice", qty: 100 }, { id: "pork", qty: 120 }]),   // 300 + 2400 = 2700원
      R("b", "egg", [{ id: "rice", qty: 100 }, { id: "egg", qty: 2 }]),      // 300 + 800 = 1100원
      R("c", "tofu", [{ id: "rice", qty: 100 }, { id: "tofu", qty: 150 }]),  // 300 + 750 = 1050원
      R("d", "pork", [{ id: "rice", qty: 90 }, { id: "pork", qty: 200 }], ["muscle"]),
    ] };
    const pm = byId(prices);
    assert(Math.abs(recipeCost(data.recipes[0], pm) - 2700) < 1e-6, "1인분 비용 2700");
    assert(Math.abs(recipeCost(data.recipes[1], pm) - 1100) < 1e-6, "1인분 비용 1100");

    // 2명 × 1일 × 1끼 = 2끼 → 메뉴 2개, 1인분씩
    const o = { goal: "diet", people: 2, days: 1, perDay: 1, budget: 5000, exclude: [], skipPantry: false };
    const p = plan(o, data, prices);
    assert(p.meals === 2 && p.menu.length === 2, "끼니·메뉴 수");
    const sumNeed = id => p.menu.reduce((s, m) => s + m.servings * (m.r.ing.find(i => i.id === id)?.qty || 0), 0);
    for (const x of p.shop) assert(Math.abs(x.need - sumNeed(x.item.id)) < 1e-9, "재료 합산 " + x.item.id);
    assert(p.shop.find(x => x.item.id === "rice").uses.length === 2, "쌀은 메뉴 2개에 쓰임");
    for (const x of p.shop) assert(x.buy >= x.need && x.buy - x.need < x.item.buy && x.buy % x.item.buy === 0, "포장 올림 " + x.item.id);
    const used = p.shop.reduce((s, x) => s + x.need * x.item.price / x.item.per, 0);
    assert(Math.abs(p.totals.used - used) < 1e-6 && Math.abs(p.totals.perMeal - used / 2) < 1e-6, "합계·1끼 비용");
    assert(Math.abs(p.totals.used - p.menu.reduce((s, m) => s + m.cost * m.servings, 0)) < 1e-6, "메뉴 합 = 재료 합");

    // 포장 올림: 돼지 120g → 500g 1팩, 쌀 pantry 빼기
    const one = plan({ ...o, people: 1, budget: 3000 }, { recipes: [data.recipes[0]] }, prices);
    const pork = one.shop.find(x => x.item.id === "pork");
    assert(pork.need === 120 && pork.buy === 500 && Math.abs(pork.buyCost - 10000) < 1e-6, "돼지 120g→500g 10000원");
    const skip = plan({ ...o, people: 1, budget: 3000, skipPantry: true }, { recipes: [data.recipes[0]] }, prices);
    assert(Math.abs(skip.totals.buy - 10000) < 1e-6 && Math.abs(one.totals.buy - 13000) < 1e-6, "양념·쌀 빼기");

    // 예산 1200원이면 비싼 a(2700원)는 안 고른다
    const cheap = plan({ ...o, budget: 1200 }, data, prices);
    assert(cheap.menu.every(m => m.cost <= 1200), "1인분이 예산보다 비싼 메뉴는 안 고름");
    // 예산 기준은 실제로 사는 돈: 한도 = 1끼 예산 × 끼니, 넘으면 넘은 금액
    assert(cheap.totals.limit === 1200 * 2 && Math.abs(cheap.overBy - Math.max(0, cheap.totals.buy - 2400)) < 1e-6
      && cheap.overBudget === cheap.totals.buy > 2400, "장볼 돈 vs 예산 한도·넘은 금액");
    const roomy = plan({ ...o, budget: 9000, skipPantry: true }, data, prices);
    assert(!roomy.overBudget && roomy.totals.buy <= roomy.totals.limit, "넉넉한 예산은 안 넘음");
    // 알레르기 제외
    const noEgg = plan({ ...o, exclude: ["egg"] }, data, prices);
    assert(noEgg.menu.every(m => !m.allergens.includes("egg")), "달걀 제외");
    // 목표 메뉴가 모자라면 다른 메뉴로 채움
    const muscle = plan({ ...o, goal: "muscle", days: 2 }, data, prices);
    assert(muscle.menu[0].r.id === "d" && muscle.menu.length === 4, "목표 먼저, 모자라면 채움");
    // 목표 여러 개: diet 또는 muscle 이면 d 도 후보
    const multi = plan({ ...o, goal: undefined, goals: ["muscle"], days: 1 }, data, prices);
    assert(multi.menu.some(m => m.r.id === "d"), "목표 여러 개(배열)");
    // 가진 재료: 두부가 있으면 c 가 먼저, 장보기에서 두부는 살 돈 0
    const withTofu = plan({ ...o, have: ["tofu"], days: 1, people: 1, budget: 5000 }, data, prices);
    assert(withTofu.menu[0].r.id === "c", "가진 재료 쓰는 메뉴 먼저");
    const tofu = withTofu.shop.find(x => x.item.id === "tofu");
    assert(tofu.have && Math.abs(withTofu.totals.buy - withTofu.shop.filter(x => !x.have).reduce((s, x) => s + x.buyCost, 0)) < 1e-6, "가진 재료는 장볼 돈에서 빠짐");
    // 뺄 재료: 돼지고기 빼면 a·d 안 나옴
    const noPork = plan({ ...o, ban: ["pork"], days: 3 }, data, prices);
    assert(noPork.menu.every(m => !m.r.ing.some(i => i.id === "pork")) && noPork.menu.length === 2, "뺄 재료");
    // 바꾸기: b 를 skip, c 는 pin → c 그대로 + 다른 하나
    const swap = plan({ ...o, pin: [null, "c"], skip: ["b"], count: 2 }, data, prices);
    assert(swap.menu[1].r.id === "c" && swap.menu.length === 2 && !swap.menu.some(m => m.r.id === "b"), "메뉴 바꾸기(자리 유지)");
    // 빼기: count 1 → 메뉴 1개가 끼니 전부
    const one1 = plan({ ...o, pin: ["c"], count: 1 }, data, prices);
    assert(one1.menu.length === 1 && one1.menu[0].servings === one1.meals, "메뉴 빼기");
    // 지난주에 먹은 메뉴(recent)는 뒤로: 예산 넉넉하면 b·c 대신 다른 것
    for (let sd = 0; sd < 20; sd++) {
      const fresh = plan({ ...o, budget: 20000, recent: ["b", "c"], days: 1, people: 1 }, data, prices, sd);
      assert(fresh.menu[0].r.id === "a", "지난주 메뉴는 뒤로");
    }
    // 아무것도 안 맞으면 빈 결과(0으로 나누기 없음)
    const none = plan({ ...o, ban: ["rice"] }, data, prices);
    assert(none.empty && none.menu.length === 0, "빈 결과");
    // 인분 합 = 끼니 수 (여러 조합)
    for (let people = 1; people <= 4; people++) for (let days = 1; days <= 7; days++) for (const perDay of [1, 2]) {
      const q = plan({ ...o, people, days, perDay }, data, prices, people + days);
      assert(q.menu.reduce((s, m) => s + m.servings, 0) === q.meals, `인분 합 ${people}/${days}/${perDay}`);
      assert(q.menu.length === Math.min(menuCount(q.meals), 4), "메뉴 수");
    }
    return true;
  }

  const api = { STAGES, GOALS, mainIng, plan, recipeCost, allergensOf, byId, unitPrice, menuCount, selfTest };
  if (typeof module !== "undefined") module.exports = api; else root.Mealprep = api;
})(this);

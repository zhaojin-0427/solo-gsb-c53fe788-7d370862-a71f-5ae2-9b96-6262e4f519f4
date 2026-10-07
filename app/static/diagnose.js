"use strict";

const MIN_POINTS = 3;
const $ = (sel) => document.querySelector(sel);
const tbPoints = $("#pointsTable tbody");
const errBox = $("#diagError");

let records = [];
let selectedId = null;
let numPoints = MIN_POINTS;
// 请求纪元（单调递增）：切换记录/改动输入/发起新请求即作废旧纪元的在途回包。
// metaEpoch 裁决详情回包，diagEpoch 裁决诊断回包，互不影响。
let metaEpoch = 0;
let diagEpoch = 0;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmt = (x, d = 4) =>
  (x === null || x === undefined) ? "—"
    : Number(x).toFixed(d).replace(/\.?0+$/, "");

function showError(msg) {
  errBox.textContent = "✗ " + msg;
  errBox.hidden = false;
}
function clearError() { errBox.hidden = true; }

/* ---------------- 记录选择 ---------------- */

async function loadRecords(prefillId) {
  const res = await fetch("/api/trials");
  const data = await res.json();
  records = data.trials || [];
  const sel = $("#recordSelect");
  sel.innerHTML = "";
  if (!records.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（暂无试算记录，请先在试算台保存一条记录）";
    sel.appendChild(opt);
    $("#diagnoseBtn").disabled = true;
    $("#recordMeta").textContent = "";
    return;
  }
  records.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `#${t.id} ${t.name}（${t.num_groups} 组 / ` +
      `${t.num_baseline_strings} 串，${t.created_at.replace("T", " ").replace("+00:00", "")}）`;
    sel.appendChild(opt);
  });
  const target = prefillId && records.some((t) => String(t.id) === String(prefillId))
    ? String(prefillId) : String(records[0].id);
  sel.value = target;
  selectedId = Number(target);
  fetchRecordMeta(selectedId);
}

/* 旧诊断结果/错误立即作废：切换记录或当前提交源（容差、当前生效测点）
 * 一旦变化，页面上不得残留与当前输入不符的结论与错误。 */
function invalidateDiagnosis() {
  diagEpoch++;
  clearError();
  $("#diagResultCard").hidden = true;
}

async function fetchRecordMeta(id) {
  selectedId = Number(id);
  invalidateDiagnosis();
  // 切换记录即作废旧详情请求与旧电压上限，仅本纪元、仍选中的回包可回填
  const epoch = ++metaEpoch;
  $("#recordMeta").textContent = "加载中…";
  const res = await fetch(`/api/trials/${id}`);
  if (epoch !== metaEpoch || selectedId !== Number(id)) return;
  if (!res.ok) { $("#recordMeta").textContent = "记录不存在"; return; }
  const rec = await res.json();
  if (epoch !== metaEpoch || selectedId !== Number(id)) return;
  // 再核对回包所属记录：A 的迟到详情不得覆盖 B 的电压上限
  if (Number(rec.id) !== Number(id)) return;
  const voc = rec.result?.baseline?.voc;
  $("#recordMeta").textContent = voc !== undefined
    ? `基线开路电压（电压上限）：${fmt(voc, 3)} V`
    : "";
}

/* ---------------- 测点录入 ---------------- */

function renderPointRows() {
  const prev = collectPointsRaw();
  tbPoints.innerHTML = "";
  for (let i = 0; i < numPoints; i++) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="num">${i + 1}</td>` +
      `<td><input class="p-v" type="text" inputmode="decimal" placeholder="0.00～基线 Voc"></td>` +
      `<td><input class="p-i" type="text" inputmode="decimal" placeholder="≥ 0"></td>`;
    tbPoints.appendChild(tr);
    if (prev[i]) {
      tr.querySelector(".p-v").value = prev[i].v;
      tr.querySelector(".p-i").value = prev[i].i;
    }
  }
}

function collectPointsRaw() {
  return [...tbPoints.querySelectorAll("tr")].map((tr) => ({
    v: tr.querySelector(".p-v").value.trim(),
    i: tr.querySelector(".p-i").value.trim(),
  }));
}

/* 批量文本：每行一个测点，支持 "V, I"（逗号/空格/Tab/分号分隔）或 JSON 对象。
 * 返回 [{v, i}]（原始字符串，交由 gatherBody 统一做数值校验）。 */
function parseBulkPoints(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    let v = null, i = null;
    if (line.startsWith("{")) {
      let obj;
      try { obj = JSON.parse(line); }
      catch (e) { throw new Error(`批量测点第 ${idx + 1} 行不是合法的 JSON：${line}`); }
      if (obj.v === undefined || obj.i === undefined) {
        throw new Error(`批量测点第 ${idx + 1} 行必须包含 v 和 i：${line}`);
      }
      v = String(obj.v); i = String(obj.i);
    } else {
      const parts = line.split(/[,\t;，；\s]+/).filter((s) => s !== "");
      if (parts.length !== 2) {
        throw new Error(`批量测点第 ${idx + 1} 行应为 “V, I” 两个数：${line}`);
      }
      [v, i] = parts;
    }
    out.push({ v, i });
  });
  return out;
}

function importBulkPoints() {
  const text = $("#bulkPoints").value;
  let parsed;
  try { parsed = parseBulkPoints(text); }
  catch (e) { showError(e.message); return; }
  clearError();
  if (parsed.length < MIN_POINTS) {
    showError(`批量测点至少需要 ${MIN_POINTS} 个，当前仅 ${parsed.length} 个`);
    return;
  }
  numPoints = parsed.length;
  renderPointRows();
  tbPoints.querySelectorAll("tr").forEach((tr, idx) => {
    tr.querySelector(".p-v").value = parsed[idx].v;
    tr.querySelector(".p-i").value = parsed[idx].i;
  });
  $("#bulkMeta").textContent = `已导入 ${parsed.length} 个测点`;
}

function gatherBody() {
  const tolRaw = $("#tolerance").value.trim();
  if (tolRaw === "" || Number.isNaN(Number(tolRaw))) {
    throw new Error("电流容差必须是有限非负数");
  }
  // 批量框非空时直接以其内容为准，免去先点“导入表格”
  const rawPoints = $("#bulkPoints").value.trim()
    ? parseBulkPoints($("#bulkPoints").value)
    : collectPointsRaw();
  const points = rawPoints.map((p, idx) => {
    if (p.v === "" || p.i === "" || Number.isNaN(Number(p.v)) || Number.isNaN(Number(p.i))) {
      throw new Error(`第 ${idx + 1} 个测点的电压/电流必须是有限数值`);
    }
    return { v: Number(p.v), i: Number(p.i) };
  });
  return { tolerance: Number(tolRaw), points };
}

/* ---------------- 提交与渲染 ---------------- */

/* 当前提交源的指纹：容差 + 实际提交的测点（批量框非空取批量，否则取表格）。
 * 回包只在与当前输入一致时才允许落表，慢请求、旧输入一律丢弃。 */
function currentInputSignature(body) {
  if (body) return JSON.stringify({ tolerance: body.tolerance, points: body.points });
  try {
    const g = gatherBody();
    return JSON.stringify({ tolerance: g.tolerance, points: g.points });
  } catch (e) { return null; }
}

async function submitDiagnosis() {
  clearError();
  if (!selectedId) { showError("请先选择一条试算记录"); return; }
  let body;
  try { body = gatherBody(); }
  catch (e) {
    // 输入已不能按旧请求解释：旧结论/错误作废，且在途回包不得再落页面
    invalidateDiagnosis();
    showError(e.message);
    return;
  }

  // 新请求成为唯一有效请求：同记录连发时，旧测点的慢响应由纪元裁决丢弃
  const epoch = ++diagEpoch;
  const reqId = selectedId;
  const reqSig = currentInputSignature(body);

  let res, data;
  try {
    res = await fetch(`/api/trials/${reqId}/diagnose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json();
  } catch (e) {
    if (epoch !== diagEpoch || selectedId !== reqId ||
        currentInputSignature() !== reqSig) return;
    showError("网络/服务错误：" + e.message);
    return;
  }
  // 按发起时记录、实际提交的测点/容差及请求先后裁决：非最新或输入已变即丢弃
  if (epoch !== diagEpoch || selectedId !== reqId ||
      currentInputSignature() !== reqSig) return;
  if (res.status === 404) { showError("试算记录不存在"); return; }
  if (!res.ok) { showError(data.detail || "诊断失败"); return; }
  if (Number(data.id) !== reqId) return;
  renderDiagnosis(data.diagnosis);
}

const VERDICT_STYLE = {
  unconfirmed: ["verdict-neutral", "无法确认异常"],
  single_group: ["verdict-single", "定位到单组退化"],
  ambiguous: ["verdict-ambiguous", "多组歧义"],
  out_of_model: ["verdict-out", "模型外偏差"],
};

function renderDiagnosis(d) {
  $("#diagResultCard").hidden = false;
  const box = $("#verdictBox");
  const [cls, title] = VERDICT_STYLE[d.verdict] || ["", d.verdict];
  box.className = "verdict " + cls;
  box.innerHTML = `<div class="verdict-title">${title}</div>` +
    `<div class="verdict-msg">${escapeHtml(d.message)}</div>` +
    `<div class="verdict-sub">健康假设可解释：${d.healthy_explainable ? "是" : "否"}
       ｜ 电流容差：${fmt(d.tolerance, 3)} A
       ｜ 基线开路电压：${fmt(d.baseline_voc, 3)} V</div>`;

  const tbP = $("#diagPointsTable tbody");
  tbP.innerHTML = "";
  d.points.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="num">${i + 1}</td>` +
      `<td class="num">${fmt(p.v)}</td>` +
      `<td class="num">${fmt(p.i_measured)}</td>` +
      `<td class="num">${fmt(p.i_theory_healthy)}</td>` +
      `<td class="num ${p.deviation > 0 ? "dev-pos" : p.deviation < 0 ? "dev-neg" : ""}">` +
      `${p.deviation > 0 ? "+" : ""}${fmt(p.deviation)}</td>` +
      `<td>${p.within_tolerance ? '<span class="tag-ok">是</span>'
        : '<span class="tag-no">否</span>'}</td>`;
    tbP.appendChild(tr);
  });

  const tbG = $("#diagGroupsTable tbody");
  tbG.innerHTML = "";
  d.groups.forEach((g) => {
    let range = "—", count = "—";
    if (g.feasible) {
      range = g.isc_min === g.isc_max
        ? `${fmt(g.isc_min, 2)}`
        : `${fmt(g.isc_min, 2)} ～ ${fmt(g.isc_max, 2)}`;
      count = g.isc_candidates;
    }
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><b>${escapeHtml(g.group)}</b></td>` +
      `<td class="num">${fmt(g.isc_original, 2)}</td>` +
      `<td class="num">${g.sensitive_points}</td>` +
      `<td>${g.feasible ? '<span class="tag-ok">可解释</span>'
        : '<span class="tag-no">不可解释</span>'}</td>` +
      `<td class="num">${range}</td>` +
      `<td class="num">${count}</td>`;
    tbG.appendChild(tr);
  });
  $("#diagResultCard").scrollIntoView?.({ behavior: "smooth" });
}

/* ---------------- 事件与初始化 ---------------- */

$("#recordSelect").addEventListener("change", (e) => fetchRecordMeta(e.target.value));
$("#addPointBtn").addEventListener("click", () => {
  numPoints++; renderPointRows();
  // 批量框非空时表格不是当前提交源，其变化不作废诊断
  if (!$("#bulkPoints").value.trim()) invalidateDiagnosis();
});
$("#removePointBtn").addEventListener("click", () => {
  if (numPoints <= MIN_POINTS) return;
  numPoints--; renderPointRows();
  if (!$("#bulkPoints").value.trim()) invalidateDiagnosis();
});
// 当前提交源的容差/测点一经修改，旧结论与旧错误立即作废
$("#tolerance").addEventListener("input", invalidateDiagnosis);
$("#bulkPoints").addEventListener("input", invalidateDiagnosis);
tbPoints.addEventListener("input", () => {
  if (!$("#bulkPoints").value.trim()) invalidateDiagnosis();
});
$("#diagnoseBtn").addEventListener("click", submitDiagnosis);
$("#bulkLoadBtn").addEventListener("click", importBulkPoints);

renderPointRows();
const prefill = new URLSearchParams(location.search).get("id");
loadRecords(prefill);

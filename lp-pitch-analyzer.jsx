import { useState, useRef, useCallback } from "react";

const SYSTEM_PROMPT = `You are a seasoned institutional LP analyst preparing an investor for a due diligence call with a GP. You have reviewed their pitch book. Your job is to arm the LP with the specific questions, data requests, and independent verification steps they need to evaluate this opportunity. Do not summarize the pitch book back to the LP. Tell them what to ask, what to request, and what to verify.

Write your analysis in this exact order using markdown headers (##). Be specific throughout. Cite page numbers, exact figures, and direct observations. When something is missing, tell the LP exactly what document or data point to request.

## Deal Snapshot
One paragraph. Property name, sponsor, location, strategy, unit count or SF, purchase price (total and per unit/SF), total capitalization, hold period, target LP IRR and equity multiple. State the asset class and market tier (primary/secondary/tertiary). If any of these are not disclosed, say "Not disclosed" for each.

## Verdict
One of: PROCEED | WORTH EXPLORING | PROCEED WITH CAUTION | PASS

Follow with 2-3 sentences on why. Be direct.

## Before Your Next GP Call: Questions by Category

Organize your questions into the categories below. For each category, provide:
- A brief assessment (2-3 sentences) of what the pitch book does and does not tell you
- Then numbered, specific questions the LP should ask the GP
- Where relevant, include the exact data request (e.g., "Request a rent comp survey within a 3-mile radius of the subject property" or "Request 3 years of audited financials for [tenant name]")

### Sponsor & Track Record
Evaluate using these criteria: track records must include every investment, not cherry-picked winners. Returns from 2019-2022 prove almost nothing. Investments under a prior firm must be disclosed separately. Was the GP the controlling principal or a capital raiser/minority partner?

Questions should cover: verified deal-level exit data, role in each claimed deal, post-2022 performance, any capital calls or distressed assets.

### GP Alignment & Fees
Calculate and disclose: net sponsor exposure (co-invest minus all fees at close), fee-to-capital ratio, and how each compares to benchmarks (10% co-invest satisfactory, 1-2% acquisition fee market, 5-6% PM market, 20-30% promote market). For development deals: if developer fee + affiliated GC fee exceeds co-invest, flag it as "GP has no economic downside."

Questions should cover: exact co-invest amount, full fee schedule, waterfall mechanics from the PPM, whether pref is truly annual or has delayed accrual/declining balance, and any fee clawback provisions.

### Underwriting & Assumptions
For each key assumption, tell the LP what to verify:
- Acquisition cap rate: was it T12 actuals or pro forma? Recalculate if possible. Flag manipulation.
- Exit cap rate: back-solve the implied exit price from projected proceeds. Standard practice assumes 10-20bps annual expansion for aging assets. Exit tighter than new construction for a vintage asset is indefensible.
- Rents: tell the LP to request a specific comp survey (e.g., "Request a CoStar rent comp pull for [asset class] within a 3-mile radius of [address], filtered by [vintage/class]").
- Vacancy: tell the LP to pull submarket vacancy data by star rating.
- Development spread: for development deals, calculate untrended YOC minus spot cap rate. Below 150bps is too thin.

### Debt & Capital Structure
Evaluate leverage, rate type, maturity alignment, and negative leverage. If the loan is not committed, tell the LP to request the executed term sheet before closing. Calculate the impact of a 150-200bps rate increase if floating.

### Market Verification
Give the LP exact independent verification steps using the actual property address, city, asset class, and tenant name:
- "Pull CoStar submarket data for [city/submarket], filtered by [star rating/vintage], and compare vacancy and rent growth projections to the sponsor's claims."
- "Check the property website and 2-3 comp property websites for live asking rents and concessions."
- "Pull CoStar sales comps for [asset class] within [radius] of [address], closed in the last 24 months."
- For single-tenant: "Request 2-3 years of audited financials for [tenant name]."

### Structure & Legal
Evaluate: IRR vs AAR waterfall, structural GP ownership without capital, capital call provisions, fund redeployment rights, preferred equity senior to LP. Questions should cover LP agreement review, voting rights, and GP removal.

## Sensitivity Analysis
ONE 5x5 sensitivity table with the two most impactful assumptions for this strategy. GP base case in the center marked with *. After the table, 2-3 sentences on where the deal breaks. If data is insufficient, state what is missing and use market assumptions labeled as analyst estimates.

## Documents to Request Before Committing
A numbered checklist of every specific document and data pull. Be concrete: "Trailing 12-month operating statement from the seller," "CoStar submarket report for [city], [asset class], [star rating]," "Executed loan commitment letter," "LP agreement with full waterfall," etc.

CRITICAL RULES:
- Never parrot GP marketing language.
- Calculate net sponsor exposure on every deal.
- Back-solve exit cap from projected sale proceeds.
- Track records from 2019-2022 prove almost nothing.
- Sophisticated marketing does not correlate with investment quality.
- Be direct. Say "this is aggressive" not "this may warrant further consideration."`;

function AnalyzerApp() {
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef(null);

  const handleFile = useCallback((f) => {
    if (!f) return;
    if (f.type !== "application/pdf") { setError("Please upload a PDF file."); return; }
    if (f.size > 30 * 1024 * 1024) { setError("File must be under 30MB."); return; }
    setFile(f);
    setFilePreview({ name: f.name, size: (f.size / (1024 * 1024)).toFixed(1) });
    setError(null);
    setAnalysis("");
  }, []);

  const onDrop = useCallback((e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); }, [handleFile]);

  const analyzeDocument = async () => {
    if (!file) return;
    setLoading(true); setError(null); setAnalysis(""); setProgress(10);
    try {
      const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = () => rej(new Error("Failed to read file")); r.readAsDataURL(file); });
      setProgress(30);
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 8192, system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: "Analyze this GP pitch book and prepare me for a due diligence call. Tell me what to ask, what to request, and what to verify independently. Follow the framework exactly." }
          ]}]
        }),
      });
      setProgress(70);
      if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err?.error?.message || `API error: ${response.status}`); }
      const data = await response.json();
      setProgress(100);
      setAnalysis(data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "No analysis returned.");
    } catch (err) { setError(err.message || "Analysis failed."); } finally { setLoading(false); }
  };

  const reset = () => { setFile(null); setFilePreview(null); setAnalysis(""); setError(null); setProgress(0); };

  const renderMarkdown = (md) => {
    if (!md) return null;
    const lines = md.split("\n");
    const elements = [];
    let currentList = [];
    let currentTable = [];
    let listType = "ul";

    const flushList = () => {
      if (currentList.length > 0) {
        const items = currentList.map((item, i) => <li key={i} style={styles.listItem}>{renderInline(item)}</li>);
        elements.push(listType === "ol"
          ? <ol key={`ol-${elements.length}`} style={styles.orderedList}>{items}</ol>
          : <ul key={`ul-${elements.length}`} style={styles.list}>{items}</ul>);
        currentList = []; listType = "ul";
      }
    };
    const flushTable = () => {
      if (currentTable.length === 0) return;
      const dataRows = currentTable.filter(r => !r.every(c => /^[-:]+$/.test(c.trim())));
      if (dataRows.length === 0) { currentTable = []; return; }
      const header = dataRows[0], body = dataRows.slice(1);
      elements.push(
        <div key={`tbl-${elements.length}`} style={styles.tableWrapper}><div style={styles.tableScroll}><table style={styles.table}>
          <thead><tr>{header.map((c, ci) => <th key={ci} style={{ ...styles.th, textAlign: ci === 0 ? "left" : "center" }}>{renderInline(c.trim())}</th>)}</tr></thead>
          <tbody>{body.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => {
            const val = cell.trim(), isBase = val.includes("*"), numMatch = val.replace("*","").match(/([\d.]+)%/), numVal = numMatch ? parseFloat(numMatch[1]) : null;
            let bg = "transparent";
            if (isBase) bg = "var(--accent-light)"; else if (numVal !== null && ci > 0) { if (numVal < 8) bg = "var(--risk-bg)"; else if (numVal >= 15) bg = "rgba(44,95,74,0.08)"; }
            return <td key={ci} style={{ ...styles.td, textAlign: ci === 0 ? "left" : "center", fontWeight: ci === 0 || isBase ? 600 : 400, background: bg, color: isBase ? "var(--accent)" : numVal !== null && numVal < 8 && ci > 0 ? "var(--risk-red)" : "var(--text-secondary)" }}>{renderInline(val)}</td>;
          })}</tr>)}</tbody>
        </table></div><p style={styles.tableNote}>* = GP base case. Cells below 8% pref highlighted.</p></div>);
      currentTable = [];
    };
    const renderInline = (text) => text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 600 }}>{part.slice(2, -2)}</strong> : part);

    lines.forEach((line, idx) => {
      const t = line.trim();
      if (t.startsWith("|") && t.endsWith("|")) { flushList(); currentTable.push(t.slice(1, -1).split("|")); }
      else {
        flushTable();
        if (t.startsWith("## ")) { flushList(); const title = t.slice(3); const isV = title.toLowerCase().includes("verdict"); const isQ = title.toLowerCase().includes("call") || title.toLowerCase().includes("question"); const isD = title.toLowerCase().includes("document") || title.toLowerCase().includes("request"); const isS = title.toLowerCase().includes("sensitivity"); let bc = "var(--accent)"; if (isV) bc = "#8b6914"; else if (isQ) bc = "#2563eb"; else if (isD) bc = "#c0392b"; else if (isS) bc = "#d4880f"; elements.push(<div key={`h2-${idx}`} style={{ ...styles.sectionHeader, borderLeftColor: bc }}><h2 style={styles.h2}>{title}</h2></div>); }
        else if (t.startsWith("### ")) { flushList(); elements.push(<h3 key={`h3-${idx}`} style={styles.h3}>{t.slice(4)}</h3>); }
        else if (/^\d+\.\s/.test(t)) { if (listType !== "ol") flushList(); listType = "ol"; currentList.push(t.replace(/^\d+\.\s/, "")); }
        else if (t.startsWith("- ") || t.startsWith("• ")) { if (listType !== "ul") flushList(); listType = "ul"; currentList.push(t.slice(2)); }
        else if (t === "") { flushList(); elements.push(<div key={`sp-${idx}`} style={{ height: 8 }} />); }
        else { flushList(); elements.push(<p key={`p-${idx}`} style={styles.paragraph}>{renderInline(t)}</p>); }
      }
    });
    flushTable(); flushList();
    return elements;
  };

  return (
    <div style={styles.container}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root { --bg:#faf9f7;--surface:#fff;--text-primary:#1a1a1a;--text-secondary:#5c5c5c;--text-muted:#8a8a8a;--border:#e8e5e0;--accent:#2c5f4a;--accent-light:#e8f0ec;--risk-red:#c0392b;--risk-bg:#fdf2f0;--blue:#2563eb;--blue-light:#eff6ff; }
        @media(prefers-color-scheme:dark){ :root { --bg:#141413;--surface:#1e1e1c;--text-primary:#e8e5e0;--text-secondary:#a0a0a0;--text-muted:#6a6a6a;--border:#2e2e2c;--accent:#5dab8c;--accent-light:#1a2e25;--risk-red:#e05a4b;--risk-bg:#2a1a18;--blue:#60a5fa;--blue-light:#1a2233; }}
        .upload-zone{transition:all .2s ease} .upload-zone:hover{border-color:var(--accent)!important;background:var(--accent-light)!important}
        .analyze-btn{transition:all .15s ease} .analyze-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(44,95,74,.25)} .analyze-btn:disabled{opacity:.5;cursor:not-allowed}
        .progress-bar{animation:pp 1.5s ease-in-out infinite} @keyframes pp{0%,100%{opacity:1}50%{opacity:.7}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}} .fade-in{animation:fadeIn .4s ease forwards}
        ol{padding-left:24px;margin-bottom:12px} ol li{margin-bottom:8px}
      `}</style>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div><h1 style={styles.title}>Pitch Book Analyzer</h1><p style={styles.subtitle}>GP due diligence prep for LP investors</p></div>
          {analysis && <button onClick={reset} style={styles.resetBtn}>New Analysis</button>}
        </div>
        <div style={styles.headerRule} />
      </header>
      <main style={styles.main}>
        {!analysis ? (
          <div className="fade-in" style={styles.uploadSection}>
            <div className="upload-zone" onDrop={onDrop} onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onClick={()=>fileInputRef.current?.click()}
              style={{ ...styles.uploadZone, borderColor: dragOver?"var(--accent)":filePreview?"var(--accent)":"var(--border)", background: dragOver?"var(--accent-light)":filePreview?"var(--accent-light)":"transparent" }}>
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={e=>handleFile(e.target.files?.[0])} style={{display:"none"}} />
              {filePreview ? (<div style={{textAlign:"center"}}><div style={styles.fileIcon}>PDF</div><p style={styles.fileName}>{filePreview.name}</p><p style={styles.fileSize}>{filePreview.size} MB</p></div>)
                : (<div style={{textAlign:"center"}}><div style={styles.uploadIcon}>&#8593;</div><p style={styles.uploadText}>Drop a GP pitch book here</p><p style={styles.uploadHint}>PDF up to 30MB</p></div>)}
            </div>
            {error && <p style={styles.error}>{error}</p>}
            <button className="analyze-btn" onClick={analyzeDocument} disabled={!file||loading} style={styles.analyzeBtn}>{loading?"Analyzing...":"Prepare My Due Diligence"}</button>
            {loading && (<div style={styles.progressContainer}><div style={styles.progressTrack}><div className="progress-bar" style={{...styles.progressFill,width:`${progress}%`}}/></div><p style={styles.progressText}>{progress<30?"Reading document...":progress<70?"Analyzing structure, terms, and assumptions...":"Building your diligence questions..."}</p></div>)}
            <div style={styles.infoBox}>
              <p style={styles.infoTitle}>What you'll get</p>
              <div style={styles.infoGrid}>
                {[{label:"GP Questions by Category",desc:"Specific questions to ask on your next call, organized by topic"},{label:"Independent Verification Steps",desc:"Exact CoStar pulls, comp surveys, and data requests to run yourself"},{label:"Net Sponsor Exposure",desc:"Co-invest minus fees. Is the GP actually at risk alongside you?"},{label:"Sensitivity Analysis",desc:"Where the deal breaks and how optimistic the base case really is"}].map((item,i)=>(
                  <div key={i} style={styles.infoItem}><p style={styles.infoLabel}>{item.label}</p><p style={styles.infoDesc}>{item.desc}</p></div>))}
              </div>
            </div>
          </div>
        ) : (
          <div className="fade-in" style={styles.analysisContainer}>
            <div style={styles.analysisMeta}><span style={styles.metaTag}>Due Diligence Prep</span><span style={styles.metaFile}>{filePreview?.name}</span></div>
            <div style={styles.analysisContent}>{renderMarkdown(analysis)}</div>
            <div style={styles.disclaimer}>AI-generated analysis to support your due diligence. Verify all figures against source documents. This is a starting point, not a replacement for independent evaluation.</div>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  container:{fontFamily:"'DM Sans',sans-serif",background:"var(--bg)",color:"var(--text-primary)",minHeight:"100vh",width:"100%"},
  header:{padding:"32px 32px 0",maxWidth:780,margin:"0 auto"},headerInner:{display:"flex",justifyContent:"space-between",alignItems:"flex-start"},
  title:{fontFamily:"'DM Serif Display',serif",fontSize:28,fontWeight:400,color:"var(--text-primary)",letterSpacing:"-0.02em",lineHeight:1.2},
  subtitle:{fontSize:14,color:"var(--text-muted)",marginTop:4,fontWeight:400},headerRule:{height:1,background:"var(--border)",marginTop:20},
  resetBtn:{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:500,color:"var(--accent)",background:"var(--accent-light)",border:"1px solid var(--accent)",borderRadius:6,padding:"8px 16px",cursor:"pointer"},
  main:{maxWidth:780,margin:"0 auto",padding:"32px 32px 64px"},uploadSection:{display:"flex",flexDirection:"column",gap:24},
  uploadZone:{border:"1.5px dashed var(--border)",borderRadius:12,padding:"48px 32px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  uploadIcon:{fontSize:28,color:"var(--text-muted)",marginBottom:12,fontWeight:300},uploadText:{fontSize:15,color:"var(--text-secondary)",fontWeight:500},
  uploadHint:{fontSize:13,color:"var(--text-muted)",marginTop:4},
  fileIcon:{display:"inline-block",background:"var(--risk-bg)",color:"var(--risk-red)",fontSize:11,fontWeight:600,letterSpacing:"0.05em",padding:"6px 12px",borderRadius:6,marginBottom:12},
  fileName:{fontSize:15,fontWeight:500,color:"var(--text-primary)"},fileSize:{fontSize:13,color:"var(--text-muted)",marginTop:2},
  error:{fontSize:13,color:"var(--risk-red)",background:"var(--risk-bg)",padding:"10px 14px",borderRadius:8},
  analyzeBtn:{fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,color:"#fff",background:"var(--accent)",border:"none",borderRadius:8,padding:"14px 28px",cursor:"pointer",width:"100%"},
  progressContainer:{display:"flex",flexDirection:"column",gap:8},progressTrack:{height:3,background:"var(--border)",borderRadius:2,overflow:"hidden"},
  progressFill:{height:"100%",background:"var(--accent)",borderRadius:2,transition:"width 0.5s ease"},progressText:{fontSize:13,color:"var(--text-muted)",fontStyle:"italic"},
  infoBox:{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:"20px 24px",marginTop:8},
  infoTitle:{fontSize:13,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:16},
  infoGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16},infoItem:{},
  infoLabel:{fontSize:14,fontWeight:600,color:"var(--text-primary)",marginBottom:2},infoDesc:{fontSize:13,color:"var(--text-secondary)",lineHeight:1.45},
  analysisContainer:{},analysisMeta:{display:"flex",alignItems:"center",gap:12,marginBottom:28},
  metaTag:{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--blue)",background:"var(--blue-light)",padding:"4px 10px",borderRadius:4},
  metaFile:{fontSize:13,color:"var(--text-muted)"},analysisContent:{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:12,padding:"32px 36px",lineHeight:1.7},
  sectionHeader:{borderLeft:"3px solid var(--accent)",paddingLeft:16,marginTop:28,marginBottom:16},
  h2:{fontFamily:"'DM Serif Display',serif",fontSize:20,fontWeight:400,color:"var(--text-primary)"},
  h3:{fontSize:15,fontWeight:600,color:"var(--text-primary)",marginTop:20,marginBottom:10,paddingBottom:6,borderBottom:"1px solid var(--border)"},
  paragraph:{fontSize:14.5,color:"var(--text-secondary)",lineHeight:1.75,marginBottom:10},
  list:{paddingLeft:20,marginBottom:12},orderedList:{paddingLeft:24,marginBottom:12},
  listItem:{fontSize:14.5,color:"var(--text-secondary)",lineHeight:1.7,marginBottom:6},
  tableWrapper:{margin:"16px 0 20px"},tableScroll:{overflowX:"auto",borderRadius:8,border:"1px solid var(--border)"},
  table:{width:"100%",borderCollapse:"collapse",fontFamily:"'DM Sans',sans-serif",fontSize:13},
  th:{padding:"10px 14px",fontSize:12,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.04em",background:"var(--bg)",borderBottom:"2px solid var(--border)",whiteSpace:"nowrap"},
  td:{padding:"9px 14px",borderBottom:"1px solid var(--border)",whiteSpace:"nowrap",fontSize:13.5,fontVariantNumeric:"tabular-nums"},
  tableNote:{fontSize:11,color:"var(--text-muted)",marginTop:6,fontStyle:"italic"},
  disclaimer:{fontSize:12,color:"var(--text-muted)",marginTop:24,padding:"12px 16px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,lineHeight:1.5,fontStyle:"italic"},
};

export default AnalyzerApp;

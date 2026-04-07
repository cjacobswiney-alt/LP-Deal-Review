import { useState, useRef, useCallback } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).href;

async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(" "));
  }
  return pages.join("\n\n");
}

function AnalyzerApp() {
  const [userEmail, setUserEmail] = useState(() => {
    try { return localStorage.getItem("lp-user-email") || ""; } catch { return ""; }
  });
  const [registered, setRegistered] = useState(() => {
    try { return !!localStorage.getItem("lp-user-email"); } catch { return false; }
  });
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regCompany, setRegCompany] = useState("");
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!regEmail.trim()) { setRegError("Email is required."); return; }
    setRegLoading(true); setRegError("");
    try {
      const res = await fetch("/api/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: regEmail.trim(), name: regName.trim(), company: regCompany.trim() }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Registration failed"); }
      localStorage.setItem("lp-user-email", regEmail.trim().toLowerCase());
      setUserEmail(regEmail.trim().toLowerCase());
      setRegistered(true);
    } catch (err) { setRegError(err.message); } finally { setRegLoading(false); }
  };

  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [feedbackList, setFeedbackList] = useState([]);
  const [docsOpen, setDocsOpen] = useState(false);
  const [showFeedbackHistory, setShowFeedbackHistory] = useState(false);
  const fileInputRef = useRef(null);

  const loadFeedback = useCallback(async () => {
    try { const res = await fetch("/api/feedback"); setFeedbackList(await res.json()); } catch {}
  }, []);

  // Load feedback from server on mount
  useState(() => { loadFeedback(); });

  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const addFeedback = async () => {
    if (!feedbackInput.trim()) return;
    setFeedbackLoading(true);
    try {
      // Send raw feedback to server — it will use Claude to parse into discrete rules
      const res = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: feedbackInput.trim() }) });
      setFeedbackList(await res.json());
      setFeedbackInput("");
    } catch {} finally { setFeedbackLoading(false); }
  };
  const removeFeedback = async (idx) => {
    try {
      const res = await fetch("/api/feedback", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: idx }) });
      setFeedbackList(await res.json());
    } catch {}
  };

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
    setLoading(true); setError(null); setAnalysis(""); setProgress(0);

    // Smooth progress animation — crawls from 0 to ~90 over ~60 seconds, slowing as it goes
    let currentProgress = 0;
    const progressInterval = setInterval(() => {
      const remaining = 92 - currentProgress;
      const increment = Math.max(0.15, remaining * 0.02);
      currentProgress = Math.min(92, currentProgress + increment);
      setProgress(currentProgress);
    }, 300);

    try {
      // Extract text client-side to avoid Vercel's 4.5MB body limit
      const pdfText = await extractPdfText(file);
      const response = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfText, fileName: file.name, fileSizeMb: parseFloat((file.size / (1024 * 1024)).toFixed(1)), userEmail }),
      });
      if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err?.error?.message || `API error: ${response.status}`); }
      // Handle both SSE (local dev) and JSON (Vercel) responses
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        const processLines = (linesToProcess) => {
          for (const line of linesToProcess) {
            if (line === "data: [DONE]") continue;
            if (!line.startsWith("data: ")) continue;
            try {
              const { text } = JSON.parse(line.slice(6));
              if (text) { fullText += text; setAnalysis(fullText); }
            } catch {}
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) { buffer += decoder.decode(); processLines(buffer.split("\n")); break; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          processLines(lines);
        }
        if (!fullText) setAnalysis("No analysis returned.");
      } else {
        const data = await response.json();
        setAnalysis(data.analysis || "No analysis returned.");
      }
      clearInterval(progressInterval);
      setProgress(100);
    } catch (err) { clearInterval(progressInterval); setError(err.message || "Analysis failed."); } finally { setLoading(false); }
  };

  const reset = () => { setFile(null); setFilePreview(null); setAnalysis(""); setError(null); setProgress(0); setDocsOpen(false); };

  const splitDocs = (md) => {
    const pattern = /\n## Documents to Request[^\n]*/i;
    const match = md.match(pattern);
    if (!match) return { main: md, docs: null };
    const idx = match.index;
    return { main: md.slice(0, idx).trimEnd(), docs: md.slice(idx).trim() };
  };

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
        <div key={`tbl-${elements.length}`} className="print-table-wrapper" style={styles.tableWrapper}><div style={styles.tableScroll}><table style={styles.table}>
          <thead><tr>{header.map((c, ci) => <th key={ci} style={{ ...styles.th, textAlign: ci === 0 ? "left" : "center" }}>{renderInline(c.trim())}</th>)}</tr></thead>
          <tbody>{body.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => {
            const val = cell.trim(), isBase = val.includes("*"), numMatch = val.replace("*","").match(/([\d.]+)%/), numVal = numMatch ? parseFloat(numMatch[1]) : null;
            let bg = "transparent";
            if (isBase) bg = "var(--accent-light)"; else if (numVal !== null && ci > 0) { if (numVal < 8) bg = "var(--risk-bg)"; else if (numVal >= 15) bg = "rgba(44,95,74,0.08)"; }
            return <td key={ci} style={{ ...styles.td, textAlign: ci === 0 ? "left" : "center", fontWeight: ci === 0 || isBase ? 600 : 400, background: bg, color: isBase ? "var(--accent)" : numVal !== null && numVal < 8 && ci > 0 ? "var(--risk-red)" : "var(--text-secondary)" }}>{renderInline(val)}</td>;
          })}</tr>)}</tbody>
        </table></div><p className="print-table-note" style={styles.tableNote}>* = GP base case. Cells below 8% pref highlighted.</p></div>);
      currentTable = [];
    };
    const renderInline = (text) => text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 600 }}>{part.slice(2, -2)}</strong> : part);

    lines.forEach((line, idx) => {
      const t = line.trim();
      // Peek ahead: if blank line is followed by a numbered item, don't flush the ordered list
      const nextNonEmpty = () => { for (let i = idx + 1; i < lines.length; i++) { const nt = lines[i].trim(); if (nt !== "") return nt; } return ""; };
      if (t.startsWith("|") && t.endsWith("|")) { flushList(); currentTable.push(t.slice(1, -1).split("|")); }
      else {
        flushTable();
        if (t.startsWith("## ")) { flushList(); const title = t.slice(3); const isV = title.toLowerCase().includes("verdict"); const isQ = title.toLowerCase().includes("call") || title.toLowerCase().includes("question"); const isD = title.toLowerCase().includes("document") || title.toLowerCase().includes("request"); let bc = "var(--accent)"; if (isV) bc = "#8b6914"; else if (isQ) bc = "#2563eb"; else if (isD) bc = "#c0392b"; elements.push(<div key={`h2-${idx}`} className="print-section-header" style={{ ...styles.sectionHeader, borderLeftColor: bc }}><h2 style={styles.h2}>{title}</h2></div>); }
        else if (t.startsWith("### ")) { flushList(); elements.push(<h3 key={`h3-${idx}`} style={styles.h3}>{t.slice(4)}</h3>); }
        else if (/^\d+\.\s/.test(t)) { if (listType !== "ol") flushList(); listType = "ol"; currentList.push(t.replace(/^\d+\.\s/, "")); }
        else if (t.startsWith("- ") || t.startsWith("• ")) { if (listType !== "ul") flushList(); listType = "ul"; currentList.push(t.slice(2)); }
        else if (t === "") { if (listType === "ol" && /^\d+\.\s/.test(nextNonEmpty())) { /* skip — keep collecting ol items */ } else { flushList(); elements.push(<div key={`sp-${idx}`} className="print-spacer" style={{ height: 8 }} />); } }
        else { flushList(); elements.push(<p key={`p-${idx}`} style={styles.paragraph}>{renderInline(t)}</p>); }
      }
    });
    flushTable(); flushList();
    return elements;
  };

  const globalStyles = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --bg:#faf9f7;--surface:#fff;--text-primary:#1a1a1a;--text-secondary:#5c5c5c;--text-muted:#8a8a8a;--border:#e8e5e0;--accent:#2c5f4a;--accent-light:#e8f0ec;--risk-red:#c0392b;--risk-bg:#fdf2f0;--blue:#2563eb;--blue-light:#eff6ff; }
    @media(prefers-color-scheme:dark){ :root { --bg:#141413;--surface:#1e1e1c;--text-primary:#e8e5e0;--text-secondary:#a0a0a0;--text-muted:#6a6a6a;--border:#2e2e2c;--accent:#5dab8c;--accent-light:#1a2e25;--risk-red:#e05a4b;--risk-bg:#2a1a18;--blue:#60a5fa;--blue-light:#1a2233; }}`;

  if (!registered) {
    return (
      <div style={styles.container}>
        <style>{globalStyles}</style>
        <div style={styles.gateWrapper}>
          <div style={styles.gateCard}>
            <h1 style={styles.gateTitle}>Pitch Book Analyzer</h1>
            <p style={styles.gateSubtitle}>AI-powered GP due diligence prep for LP investors</p>
            <div style={styles.gateDivider} />
            <p style={styles.gateDesc}>Upload a GP pitch book and get a structured due diligence report with specific questions to ask, documents to request, and independent verification steps.</p>
            <form onSubmit={handleRegister} style={styles.gateForm}>
              <input value={regName} onChange={e=>setRegName(e.target.value)} placeholder="Name" style={styles.gateInput} />
              <input value={regEmail} onChange={e=>setRegEmail(e.target.value)} placeholder="Email *" type="email" required style={styles.gateInput} />
              <input value={regCompany} onChange={e=>setRegCompany(e.target.value)} placeholder="Company (optional)" style={styles.gateInput} />
              {regError && <p style={styles.gateError}>{regError}</p>}
              <button type="submit" disabled={regLoading} style={{...styles.gateBtn, opacity: regLoading ? 0.5 : 1}}>{regLoading ? "..." : "Get Started"}</button>
            </form>
            <p style={styles.gateDisclaimer}>We'll never share your information. By continuing you agree to our terms of use.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <style>{`${globalStyles}
        .upload-zone{transition:all .2s ease} .upload-zone:hover{border-color:var(--accent)!important;background:var(--accent-light)!important}
        .analyze-btn{transition:all .15s ease} .analyze-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(44,95,74,.25)} .analyze-btn:disabled{opacity:.5;cursor:not-allowed}
        .progress-bar{animation:pp 1.5s ease-in-out infinite} @keyframes pp{0%,100%{opacity:1}50%{opacity:.7}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}} .fade-in{animation:fadeIn .4s ease forwards}
        ol{padding-left:24px;margin-bottom:12px} ol li{margin-bottom:8px}
        @media print{
          body{background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
          .no-print{display:none!important}
          .mobile-header{padding:0!important}
          .mobile-main{padding:8px 0 0!important}
          .mobile-analysis-content{border:none!important;padding:0!important;box-shadow:none!important}
          .print-analysis{background:#fff!important;border:none!important}
          .fade-in{animation:none!important}
          .print-meta{margin-bottom:12px!important}
          .print-section-header{margin-top:16px!important;margin-bottom:8px!important;padding-left:12px!important}
          .print-section-header h2{font-size:16px!important}
          h3{font-size:13px!important;margin-top:12px!important;margin-bottom:6px!important;padding-bottom:3px!important}
          p{font-size:11.5px!important;line-height:1.5!important;margin-bottom:6px!important}
          li{font-size:11.5px!important;line-height:1.5!important;margin-bottom:4px!important;page-break-inside:avoid}
          ul,ol{margin-bottom:6px!important;padding-left:18px!important}
          table{page-break-inside:avoid;font-size:11px!important}
          th{padding:5px 10px!important;font-size:10px!important}
          td{padding:4px 10px!important;font-size:11px!important}
          .print-table-wrapper{margin:8px 0 12px!important}
          .print-table-note{margin-top:3px!important;font-size:9px!important}
          .print-disclaimer{margin-top:12px!important;padding:8px 12px!important;font-size:10px!important}
          h2,h3{page-break-after:avoid}
          .print-spacer{height:4px!important}
          @page{margin:1.2cm}
        }
        @media(max-width:640px){
          .mobile-header{padding:20px 16px 0!important}
          .mobile-main{padding:20px 16px 48px!important}
          .mobile-info-grid{grid-template-columns:1fr!important}
          .mobile-upload-zone{padding:32px 16px!important}
          .mobile-analysis-content{padding:20px 16px!important}
          .mobile-title{font-size:22px!important}
        }
      `}</style>
      <header className="mobile-header" style={styles.header}>
        <div style={styles.headerInner}>
          <div><h1 className="mobile-title" style={styles.title}>Pitch Book Analyzer</h1><p style={styles.subtitle}>GP due diligence prep for LP investors</p></div>
          {analysis && <div style={{display:"flex",gap:8}}><button className="no-print" onClick={()=>window.print()} style={styles.resetBtn}>Print</button><button className="no-print" onClick={reset} style={styles.resetBtn}>New Analysis</button></div>}
        </div>
        <div className="no-print" style={styles.headerRule} />
      </header>
      <main className="mobile-main" style={styles.main}>
        {!analysis ? (
          <div className="fade-in" style={styles.uploadSection}>
            <div className="upload-zone mobile-upload-zone" onDrop={onDrop} onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onClick={()=>fileInputRef.current?.click()}
              style={{ ...styles.uploadZone, borderColor: dragOver?"var(--accent)":filePreview?"var(--accent)":"var(--border)", background: dragOver?"var(--accent-light)":filePreview?"var(--accent-light)":"transparent" }}>
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={e=>handleFile(e.target.files?.[0])} style={{display:"none"}} />
              {filePreview ? (<div style={{textAlign:"center"}}><div style={styles.fileIcon}>PDF</div><p style={styles.fileName}>{filePreview.name}</p><p style={styles.fileSize}>{filePreview.size} MB</p></div>)
                : (<div style={{textAlign:"center"}}><div style={styles.uploadIcon}>&#8593;</div><p style={styles.uploadText}>Drop a GP pitch book here</p><p style={styles.uploadHint}>PDF up to 30MB</p></div>)}
            </div>
            {error && <p style={styles.error}>{error}</p>}
            <button className="analyze-btn" onClick={analyzeDocument} disabled={!file||loading} style={styles.analyzeBtn}>{loading?"Analyzing...":"Prepare My Due Diligence"}</button>
            {loading && (<div style={styles.progressContainer}><div style={styles.progressTrack}><div className="progress-bar" style={{...styles.progressFill,width:`${progress}%`}}/></div><p style={styles.progressText}>{progress<15?"Reading document...":progress<40?"Extracting text and financials...":progress<65?"Analyzing structure, terms, and assumptions...":progress<85?"Building your diligence questions...":"Finalizing report..."}</p></div>)}
            <div style={styles.infoBox}>
              <p style={styles.infoTitle}>What you'll get</p>
              <div className="mobile-info-grid" style={styles.infoGrid}>
                {[{label:"GP Questions by Category",desc:"Specific questions to ask on your next call, organized by topic"},{label:"Independent Verification Steps",desc:"Exact CoStar pulls, comp surveys, and data requests to run yourself"},{label:"Net Sponsor Exposure",desc:"Co-invest minus fees. Is the GP actually at risk alongside you?"},{label:"Document Checklist",desc:"Every document and data pull to request before committing"}].map((item,i)=>(
                  <div key={i} style={styles.infoItem}><p style={styles.infoLabel}>{item.label}</p><p style={styles.infoDesc}>{item.desc}</p></div>))}
              </div>
            </div>
          </div>
        ) : (
          <div className="fade-in" style={styles.analysisContainer}>
            <div className="print-meta" style={styles.analysisMeta}><span style={styles.metaTag}>Due Diligence Prep</span><span style={styles.metaFile}>{filePreview?.name}</span></div>
            <div className="mobile-analysis-content" style={styles.analysisContent}>{renderMarkdown(splitDocs(analysis).main)}</div>
            {splitDocs(analysis).docs && (
              <div className="no-print" style={styles.docsDropdown}>
                <button onClick={()=>setDocsOpen(!docsOpen)} style={styles.docsToggle}>
                  <div style={styles.docsToggleLeft}>
                    <span style={styles.docsToggleText}>Documents to Request Before Committing</span>
                    <span style={styles.docsToggleHint}>{docsOpen ? "Click to collapse" : "Click to expand checklist"}</span>
                  </div>
                  <span style={{...styles.docsArrow, transform: docsOpen ? "rotate(180deg)" : "rotate(0deg)"}}>&#9662;</span>
                </button>
                {docsOpen && <div style={styles.docsContent}>{renderMarkdown(splitDocs(analysis).docs)}</div>}
              </div>
            )}
            <div className="print-disclaimer" style={styles.disclaimer}>AI-generated analysis to support your due diligence. Verify all figures against source documents. This is a starting point, not a replacement for independent evaluation.</div>
            <div className="no-print" style={styles.feedbackSection}>
              <p style={styles.feedbackTitle}>Improve Future Analyses</p>
              <p style={styles.feedbackHint}>Tell the model what to do differently. Each piece of feedback is applied to all future analyses.</p>
              <div style={styles.feedbackInputRow}>
                <input value={feedbackInput} onChange={e=>setFeedbackInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!feedbackLoading)addFeedback()}} placeholder='e.g. "Always flag deals with less than 8% pref" or "Be more aggressive on exit cap assumptions"' style={styles.feedbackInput} disabled={feedbackLoading} />
                <button onClick={addFeedback} disabled={!feedbackInput.trim()||feedbackLoading} style={{...styles.feedbackSubmitBtn,opacity:feedbackInput.trim()&&!feedbackLoading?1:0.4}}>{feedbackLoading?"Processing...":"Add"}</button>
              </div>
              {feedbackList.length > 0 && (
                <div>
                  <button onClick={()=>setShowFeedbackHistory(!showFeedbackHistory)} style={styles.feedbackToggle}>
                    {showFeedbackHistory ? "Hide" : "Show"} feedback rules ({feedbackList.length})
                  </button>
                  {showFeedbackHistory && (
                    <div style={styles.feedbackHistoryList}>
                      {feedbackList.map((f) => (
                        <div key={f.id} style={styles.feedbackItem}>
                          <div style={styles.feedbackItemText}>
                            <span style={styles.feedbackItemRule}>{f.text}</span>
                            <span style={styles.feedbackItemDate}>{f.date} — {f.status === "approved" ? "Active" : f.status === "rejected" ? "Rejected" : "Pending review"}</span>
                          </div>
                          <button onClick={()=>removeFeedback(f.id)} style={styles.feedbackRemoveBtn}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  container:{fontFamily:"'DM Sans',sans-serif",background:"var(--bg)",color:"var(--text-primary)",minHeight:"100vh",width:"100%"},
  gateWrapper:{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:24},
  gateCard:{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:"48px 40px",maxWidth:440,width:"100%",textAlign:"center"},
  gateTitle:{fontFamily:"'DM Serif Display',serif",fontSize:32,fontWeight:400,color:"var(--text-primary)",letterSpacing:"-0.02em",marginBottom:6},
  gateSubtitle:{fontSize:14,color:"var(--text-muted)",marginBottom:0},
  gateDivider:{height:1,background:"var(--border)",margin:"24px 0"},
  gateDesc:{fontSize:14,color:"var(--text-secondary)",lineHeight:1.6,marginBottom:24,textAlign:"left"},
  gateForm:{display:"flex",flexDirection:"column",gap:12},
  gateInput:{fontFamily:"'DM Sans',sans-serif",fontSize:14,padding:"12px 14px",border:"1px solid var(--border)",borderRadius:8,background:"var(--bg)",color:"var(--text-primary)",outline:"none"},
  gateBtn:{fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,color:"#fff",background:"var(--accent)",border:"none",borderRadius:8,padding:"14px",cursor:"pointer",marginTop:4},
  gateError:{fontSize:13,color:"var(--risk-red)",textAlign:"left"},
  gateDisclaimer:{fontSize:11,color:"var(--text-muted)",marginTop:16,lineHeight:1.4},
  header:{padding:"32px 48px 0"},headerInner:{display:"flex",justifyContent:"space-between",alignItems:"flex-start"},
  title:{fontFamily:"'DM Serif Display',serif",fontSize:28,fontWeight:400,color:"var(--text-primary)",letterSpacing:"-0.02em",lineHeight:1.2},
  subtitle:{fontSize:14,color:"var(--text-muted)",marginTop:4,fontWeight:400},headerRule:{height:1,background:"var(--border)",marginTop:20},
  resetBtn:{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:500,color:"var(--accent)",background:"var(--accent-light)",border:"1px solid var(--accent)",borderRadius:6,padding:"8px 16px",cursor:"pointer"},
  main:{padding:"32px 48px 64px"},uploadSection:{display:"flex",flexDirection:"column",gap:24},
  uploadZone:{border:"1.5px dashed var(--border)",borderRadius:12,padding:"48px 32px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  uploadIcon:{fontSize:28,color:"var(--text-muted)",marginBottom:12,fontWeight:300},uploadText:{fontSize:15,color:"var(--text-secondary)",fontWeight:500},
  uploadHint:{fontSize:13,color:"var(--text-muted)",marginTop:4},
  fileIcon:{display:"inline-block",background:"var(--risk-bg)",color:"var(--risk-red)",fontSize:11,fontWeight:600,letterSpacing:"0.05em",padding:"6px 12px",borderRadius:6,marginBottom:12},
  fileName:{fontSize:15,fontWeight:500,color:"var(--text-primary)"},fileSize:{fontSize:13,color:"var(--text-muted)",marginTop:2},
  error:{fontSize:13,color:"var(--risk-red)",background:"var(--risk-bg)",padding:"10px 14px",borderRadius:8},
  analyzeBtn:{fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,color:"#fff",background:"var(--accent)",border:"none",borderRadius:8,padding:"14px 28px",cursor:"pointer",width:"100%"},
  progressContainer:{display:"flex",flexDirection:"column",gap:8},progressTrack:{height:3,background:"var(--border)",borderRadius:2,overflow:"hidden"},
  progressFill:{height:"100%",background:"var(--accent)",borderRadius:2,transition:"width 0.3s linear"},progressText:{fontSize:13,color:"var(--text-muted)",fontStyle:"italic"},
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
  docsDropdown:{marginTop:16,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,overflow:"hidden"},
  docsToggle:{fontFamily:"'DM Sans',sans-serif",width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",background:"none",border:"none",cursor:"pointer",color:"var(--text-primary)"},
  docsToggleLeft:{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:2},
  docsToggleText:{fontSize:15,fontWeight:600,color:"var(--risk-red)"},
  docsToggleHint:{fontSize:11,color:"var(--text-muted)",fontWeight:400},
  docsArrow:{fontSize:16,color:"var(--risk-red)",transition:"transform 0.2s ease",fontWeight:700},
  docsContent:{padding:"0 20px 20px",lineHeight:1.7},
  feedbackSection:{marginTop:32,padding:"24px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10},
  feedbackTitle:{fontSize:15,fontWeight:600,color:"var(--text-primary)",marginBottom:4},
  feedbackHint:{fontSize:13,color:"var(--text-muted)",marginBottom:16,lineHeight:1.4},
  feedbackInputRow:{display:"flex",gap:8},
  feedbackInput:{fontFamily:"'DM Sans',sans-serif",flex:1,fontSize:13,padding:"10px 14px",border:"1px solid var(--border)",borderRadius:8,background:"var(--bg)",color:"var(--text-primary)",outline:"none"},
  feedbackSubmitBtn:{fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,color:"#fff",background:"var(--accent)",border:"none",borderRadius:8,padding:"10px 20px",cursor:"pointer",whiteSpace:"nowrap"},
  feedbackToggle:{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"var(--text-muted)",background:"none",border:"none",cursor:"pointer",marginTop:12,padding:0,textDecoration:"underline"},
  feedbackHistoryList:{marginTop:10,display:"flex",flexDirection:"column",gap:6},
  feedbackItem:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"8px 12px",background:"var(--bg)",borderRadius:6,border:"1px solid var(--border)"},
  feedbackItemText:{display:"flex",flexDirection:"column",gap:2,flex:1,minWidth:0},
  feedbackItemRule:{fontSize:13,color:"var(--text-secondary)",lineHeight:1.4},
  feedbackItemDate:{fontSize:11,color:"var(--text-muted)"},
  feedbackRemoveBtn:{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"var(--risk-red)",background:"none",border:"1px solid var(--risk-red)",borderRadius:4,padding:"3px 8px",cursor:"pointer",whiteSpace:"nowrap"},
};

export default AnalyzerApp;

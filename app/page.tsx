'use client';

import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

interface ValeAlert {
  Action: {
    Name: string;
    Params: string[] | null;
  };
  Span: [number, number];
  Check: string;
  Description: string;
  Link: string;
  Message: string;
  Severity: string;
  Match: string;
  Line: number;
}

interface CustomRule {
  name: string;
  content: string;
}

export default function Home() {
  const [text, setText] = useState('');
  const [style, setStyle] = useState('Google');
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [results, setResults] = useState<ValeAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLint = async () => {
    if (!text.trim()) {
      alert('Please enter some text to lint.');
      return;
    }
    setLoading(true);
    setResults([]);
    try {
      const response = await fetch('/api/lint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, style, customRules }),
      });
      const data = await response.json();
      if (Array.isArray(data)) {
        setResults(data);
      } else {
        console.error('Linting error:', data);
        alert('Linting failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to lint:', error);
      alert('Failed to connect to the linting service.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setCustomRules(prev => [...prev, { name: file.name, content }]);
      };
      reader.readAsText(file);
    });
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeCustomRule = (index: number) => {
    setCustomRules(prev => prev.filter((_, i) => i !== index));
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearEditor = () => {
    if (text && confirm('Are you sure you want to clear the editor?')) {
      setText('');
      setResults([]);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-80' : 'w-0'} transition-all duration-300 ease-in-out bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0`}>
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="font-bold text-xl text-blue-800 tracking-tight">Settings</h2>
          <button onClick={() => setSidebarOpen(false)} className="p-2 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          {/* Style Guide Selection */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Base Style Guide</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none transition cursor-pointer text-sm font-semibold"
            >
              <option value="Google">Google Developer</option>
              <option value="Microsoft">Microsoft Writing</option>
              <option value="RedHat">Red Hat Style</option>
            </select>
            <p className="text-[11px] text-gray-500 leading-relaxed italic">
              Primary ruleset for validation.
            </p>
          </div>

          {/* Custom Rules */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Custom Rules</label>
              <a
                href="/example-style.yml"
                download
                className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Example
              </a>
            </div>

            <div className="space-y-2">
              {customRules.map((rule, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 bg-blue-50/50 rounded-lg border border-blue-100/50">
                  <span className="text-[11px] font-mono truncate mr-2 text-blue-700">{rule.name}</span>
                  <button onClick={() => removeCustomRule(idx)} className="text-blue-300 hover:text-red-500 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-4 px-4 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-all flex flex-col items-center gap-2 group"
            >
              <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
              <span className="text-[10px] font-black uppercase tracking-widest">Upload .yml rule</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".yml"
              className="hidden"
              multiple
            />
          </div>
        </div>

        <div className="p-6 border-t border-gray-100">
          <button
            onClick={handleLint}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:bg-blue-300 transition-all active:scale-[0.98] flex items-center justify-center gap-3 group"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="h-5 w-5 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className="tracking-widest uppercase text-sm">{loading ? 'Analyzing...' : 'Run Linting'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="p-2 text-gray-500 hover:text-blue-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            )}
            <h1 className="text-xl font-black text-gray-800 tracking-tight">
              Writer<span className="text-blue-600">Assistant</span>
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full">
               <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
               <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Live Editor</span>
            </div>
          </div>
        </header>

        {/* 3-Column Grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 overflow-hidden">

          {/* Column 1: Editor */}
          <section className="flex flex-col border-r border-gray-100 bg-white overflow-hidden">
            <div className="h-12 px-6 flex items-center justify-between border-b border-gray-50 bg-gray-50/50 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                  Editor
                </span>
                <span className="text-[9px] bg-gray-100 px-2 py-0.5 rounded text-gray-500 font-mono italic">{text.length} chars</span>
              </div>
              <div className="flex gap-1">
                <button onClick={copyToClipboard} title="Copy Content" className={`p-1.5 rounded-md transition-colors ${copied ? 'text-green-500 bg-green-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>
                  {copied ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>}
                </button>
                <button onClick={clearEditor} title="Clear All" className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="flex-1 p-8 outline-none resize-none font-mono text-sm leading-relaxed text-gray-700 bg-transparent custom-scrollbar"
              placeholder="Start typing your documentation (Markdown supported)..."
            />
          </section>

          {/* Column 2: Preview */}
          <section className="flex flex-col border-r border-gray-100 bg-white overflow-hidden">
            <div className="h-12 px-6 flex items-center border-b border-gray-50 bg-gray-50/50 shrink-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                Preview
              </span>
            </div>
            <div className="flex-1 p-10 overflow-y-auto custom-scrollbar">
              <article className="prose prose-slate max-w-none prose-headings:font-black prose-headings:tracking-tight prose-a:text-blue-600 prose-img:rounded-xl">
                <ReactMarkdown>{text || '*Rich preview will appear here...*'}</ReactMarkdown>
              </article>
            </div>
          </section>

          {/* Column 3: Results */}
          <section className="flex flex-col bg-gray-50/30 overflow-hidden">
            <div className="h-12 px-6 flex items-center justify-between border-b border-gray-50 bg-gray-50/50 shrink-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                Linting Alerts
                {results.length > 0 && (
                  <span className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[8px] font-bold">{results.length}</span>
                )}
              </span>
              {results.length > 0 && (
                <button onClick={() => setResults([])} className="text-[9px] font-bold text-gray-400 hover:text-gray-600 uppercase tracking-tighter">Clear</button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {results.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-40 grayscale pointer-events-none">
                  <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                    <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p className="text-xs font-black text-gray-500 uppercase tracking-widest">Document Clean</p>
                  <p className="text-[10px] mt-1">No style violations detected.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {results.map((alert, index) => (
                    <div key={index} className={`p-4 rounded-xl border bg-white shadow-sm transition-all hover:scale-[1.01] hover:shadow-md group ${
                      alert.Severity === 'error' ? 'border-red-100' :
                      alert.Severity === 'warning' ? 'border-yellow-100' : 'border-blue-100'
                    }`}>
                      <div className="flex items-start justify-between mb-2">
                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded shadow-sm ${
                          alert.Severity === 'error' ? 'bg-red-500 text-white' :
                          alert.Severity === 'warning' ? 'bg-yellow-400 text-yellow-900' : 'bg-blue-500 text-white'
                        }`}>
                          {alert.Severity}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-gray-400">Line {alert.Line}</span>
                      </div>
                      <p className="text-sm font-bold text-gray-800 leading-snug">{alert.Message}</p>
                      <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tight">{alert.Check}</span>
                        {alert.Link && (
                          <a href={alert.Link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 transition-colors" title="View in Style Guide">
                             <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}

'use client';

import { useState } from 'react';
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

export default function Home() {
  const [text, setText] = useState('');
  const [style, setStyle] = useState('Google');
  const [results, setResults] = useState<ValeAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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
        body: JSON.stringify({ text, style }),
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
    <main className="min-h-screen p-4 md:p-8 bg-gray-50 text-gray-900">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-blue-800 tracking-tight">Writer Assistant</h1>
          <p className="text-gray-600">Improve your documentation with Vale style guides</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center gap-2">
            <label htmlFor="style-select" className="font-semibold text-xs uppercase tracking-widest text-gray-500">Style Guide:</label>
            <select
              id="style-select"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="p-2 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none transition cursor-pointer text-sm font-medium"
            >
              <option value="Google">Google Developer</option>
              <option value="Microsoft">Microsoft Writing</option>
              <option value="RedHat">Red Hat Style</option>
            </select>
          </div>
          <button
            onClick={handleLint}
            disabled={loading}
            className="bg-blue-600 text-white px-8 py-2.5 rounded-lg font-bold shadow-md hover:bg-blue-700 disabled:bg-blue-300 transition-all active:scale-95 flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Linting...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Lint Documentation
              </>
            )}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[60vh]">
        {/* Editor Area */}
        <div className="flex flex-col border rounded-2xl bg-white shadow-lg overflow-hidden ring-1 ring-gray-200">
          <div className="bg-gray-50 px-4 py-3 border-b flex justify-between items-center">
            <div className="flex items-center gap-4">
              <span className="font-bold text-gray-700 text-xs uppercase tracking-widest">Editor</span>
              <span className="text-[10px] bg-gray-200 px-2 py-0.5 rounded text-gray-600 font-mono italic">{text.length} chars</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copyToClipboard}
                title="Copy to clipboard"
                className={`p-1.5 rounded-md transition-colors ${copied ? 'bg-green-100 text-green-600' : 'hover:bg-gray-200 text-gray-500'}`}
              >
                {copied ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                )}
              </button>
              <button
                onClick={clearEditor}
                title="Clear editor"
                className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 p-6 font-mono text-sm resize-none focus:outline-none bg-white leading-relaxed"
            placeholder="Type or paste your documentation here (Markdown supported)..."
          />
        </div>

        {/* Render Area */}
        <div className="flex flex-col border rounded-2xl bg-white shadow-lg overflow-hidden ring-1 ring-gray-200">
          <div className="bg-gray-50 px-4 py-3 border-b">
            <span className="font-bold text-gray-700 text-xs uppercase tracking-widest">Preview</span>
          </div>
          <div className="flex-1 p-8 overflow-auto bg-white custom-scrollbar">
            <div className="prose prose-slate max-w-none prose-headings:text-blue-900 prose-a:text-blue-600 prose-strong:text-gray-800">
              <ReactMarkdown>{text || '*Preview will appear here...*'}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>

      {/* Results Area */}
      <section className="mt-12 bg-white rounded-2xl shadow-xl border border-gray-200 p-8 ring-1 ring-gray-200">
        <div className="flex items-center justify-between mb-8 border-b border-gray-100 pb-4">
          <h2 className="text-2xl font-bold flex items-center gap-3 text-gray-800">
            Linting Alerts
            {results.length > 0 && (
              <span className="text-xs font-black px-2.5 py-1 rounded-full bg-red-100 text-red-600 animate-pulse">
                {results.length} ISSUES
              </span>
            )}
          </h2>
          {results.length > 0 && (
            <button
              onClick={() => setResults([])}
              className="text-xs font-bold text-gray-400 hover:text-gray-600 uppercase tracking-tighter"
            >
              Clear Results
            </button>
          )}
        </div>

        {results.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <div className="bg-green-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-xl font-medium text-gray-600">No issues detected</p>
            <p className="text-sm mt-2 max-w-xs mx-auto">Your documentation follows the style guide! Keep up the great work.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {results.map((alert, index) => (
              <div key={index} className={`flex flex-col p-5 border rounded-xl transition-all hover:scale-[1.02] hover:shadow-lg group ${
                alert.Severity === 'error' ? 'border-red-100 bg-red-50/30' :
                alert.Severity === 'warning' ? 'border-yellow-100 bg-yellow-50/30' : 'border-blue-100 bg-blue-50/30'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded shadow-sm ${
                    alert.Severity === 'error' ? 'bg-red-500 text-white' :
                    alert.Severity === 'warning' ? 'bg-yellow-400 text-yellow-900' : 'bg-blue-500 text-white'
                  }`}>
                    {alert.Severity}
                  </span>
                  <span className="font-mono text-[10px] text-gray-400 font-bold">
                    Line {alert.Line}
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-800 leading-snug flex-1">{alert.Message}</p>
                <div className="mt-4 pt-4 border-t border-gray-100/50 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">{alert.Check}</span>
                    {alert.Link && (
                      <a
                        href={alert.Link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold underline decoration-blue-200 underline-offset-2 flex items-center gap-1"
                      >
                        Style Guide Reference
                        <svg className="h-2 w-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-12 py-8 text-center border-t border-gray-200">
        <p className="text-xs text-gray-400 uppercase tracking-[0.2em] font-medium"> Powered by Vale.sh & Next.js </p>
      </footer>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </main>
  );
}

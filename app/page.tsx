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

  return (
    <main className="min-h-screen p-4 md:p-8 bg-gray-50 text-gray-900">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-blue-800">Writer Assistant</h1>
          <p className="text-gray-600">Improve your documentation with Vale style guides</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4 bg-white p-4 rounded-lg shadow-sm border">
          <div className="flex items-center gap-2">
            <label htmlFor="style-select" className="font-semibold text-sm uppercase tracking-wider text-gray-500">Style:</label>
            <select
              id="style-select"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="p-2 border rounded bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none transition"
            >
              <option value="Google">Google</option>
              <option value="Microsoft">Microsoft</option>
              <option value="RedHat">Red Hat</option>
            </select>
          </div>
          <button
            onClick={handleLint}
            disabled={loading}
            className="bg-blue-600 text-white px-8 py-2 rounded-md font-bold shadow-md hover:bg-blue-700 disabled:bg-blue-300 transition-all active:scale-95"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Linting...
              </span>
            ) : 'Lint Documentation'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[60vh]">
        {/* Editor Area */}
        <div className="flex flex-col border rounded-xl bg-white shadow-md overflow-hidden ring-1 ring-gray-200">
          <div className="bg-gray-100 px-4 py-2 border-b flex justify-between items-center">
            <span className="font-bold text-gray-700 text-sm uppercase tracking-tight">Markdown Editor</span>
            <span className="text-xs text-gray-500">{text.length} characters</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 p-6 font-mono text-sm resize-none focus:outline-none bg-white"
            placeholder="Type or paste your documentation here (Markdown supported)..."
          />
        </div>

        {/* Render Area */}
        <div className="flex flex-col border rounded-xl bg-white shadow-md overflow-hidden ring-1 ring-gray-200">
          <div className="bg-gray-100 px-4 py-2 border-b">
            <span className="font-bold text-gray-700 text-sm uppercase tracking-tight">Rendered Preview</span>
          </div>
          <div className="flex-1 p-6 overflow-auto bg-white">
            <div className="prose max-w-none">
              <ReactMarkdown>{text || '*Preview will appear here...*'}</ReactMarkdown>
            </div>
          </div>
        </div>
      </div>

      {/* Results Area */}
      <section className="mt-12 bg-white rounded-xl shadow-lg border p-6 ring-1 ring-gray-200">
        <div className="flex items-center justify-between mb-6 border-b pb-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            Linting Alerts
            <span className={`text-sm px-2 py-1 rounded-full ${results.length > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {results.length}
            </span>
          </h2>
        </div>

        {results.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <svg className="mx-auto h-12 w-12 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-lg">No issues found. Documentation looks great!</p>
            <p className="text-sm mt-1">Select a style guide and click &quot;Lint&quot; to check your work.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {results.map((alert, index) => (
              <div key={index} className={`p-4 border rounded-lg transition hover:shadow-md ${
                alert.Severity === 'error' ? 'border-red-200 bg-red-50' :
                alert.Severity === 'warning' ? 'border-yellow-200 bg-yellow-50' : 'border-blue-200 bg-blue-50'
              }`}>
                <div className="flex items-start justify-between mb-2">
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                    alert.Severity === 'error' ? 'bg-red-200 text-red-800' :
                    alert.Severity === 'warning' ? 'bg-yellow-200 text-yellow-800' : 'bg-blue-200 text-blue-800'
                  }`}>
                    {alert.Severity}
                  </span>
                  <span className="font-mono text-[10px] text-gray-500 bg-white px-1 border rounded">
                    L{alert.Line}:C{alert.Span[0]}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-800 leading-tight">{alert.Message}</p>
                <div className="mt-4 flex flex-col gap-1">
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Check: {alert.Check}</p>
                  {alert.Link && (
                    <a href={alert.Link} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline">
                      View Documentation &rarr;
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

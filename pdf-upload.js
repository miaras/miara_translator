import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(arrayBuffer) {
    const task = getDocument({ data: arrayBuffer });
    try {
        const document = await task.promise;
        const pages = [];
        for (let number = 1; number <= document.numPages; number++) {
            const page = await document.getPage(number);
            const { items } = await page.getTextContent();
            const lines = [];
            let line = '';
            for (const item of items) {
                if (typeof item.str !== 'string') continue;
                line += item.str;
                if (item.hasEOL) {
                    lines.push(line.trim());
                    line = '';
                }
            }
            if (line.trim()) lines.push(line.trim());
            const text = lines.filter(Boolean).join('\n');
            if (text) pages.push(text);
        }
        return pages.join('\n\n');
    } finally {
        await task.destroy();
    }
}

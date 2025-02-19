import { PDFPage } from '../Page/PDFPage';
import { Render } from '../Render/Render';
import { PageCollection } from './PageCollection';
import { PageFlip } from '../PageFlip';
import { Page, PageDensity } from '../Page/Page';


/**
 * Сlass representing a collection of pages as images on the canvas
 */
export class PDFPageCollection extends PageCollection {
    private readonly numPages: number;
    private readonly pdfDoc: any;
    private readonly totalPages: any;

    constructor(app: PageFlip, render: Render, doc: any, numPages: number) {
        super(app, render);
        this.numPages = numPages;
        this.pdfDoc = doc;
        this.totalPages = numPages;
        window.addEventListener('resize', () => {
            PDFPage.windowResized();
        });
    }

    // public onProgress(progress: any)
    // {
    //     const pct = Math.min(100, Math.floor((progress.loaded / progress.total) * 100));
    //     if (pct >= 100)
    //     {
    //     }
    //     console.log(`Progress ${pct}`);
    // }

    public load() {
        for (let pageNumber = 1; pageNumber <= this.numPages; pageNumber++) {
            const page = new PDFPage(this.render, this.pdfDoc, PageDensity.SOFT, pageNumber, (p: number):PDFPage =>
            {
                const idx = p - 1;
                if (idx < 0)
                    return null;
                if (idx >= this.numPages)
                    return null;
                return this.pages[idx] as PDFPage;
            });
            page.load();
            this.pages.push(page);
        }

        this.createSpread();
    }
}

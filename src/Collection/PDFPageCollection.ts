import { PDFPage } from '../Page/PDFPage';
import { Render } from '../Render/Render';
import { PageCollection } from './PageCollection';
import { PageFlip } from '../PageFlip';
import { PageDensity } from '../Page/Page';

/**
 * Сlass representing a collection of pages as images on the canvas
 */
export class PDFPageCollection extends PageCollection {
    private readonly numPages: number;
    private readonly url: string;

    constructor(app: PageFlip, render: Render, url: string, numPages: number) {
        super(app, render);
        this.numPages = numPages;
        this.url = url;
    }

    public load(): void {
        for (let pageNumber = 1; pageNumber <= this.numPages; pageNumber++) {
            const page = new PDFPage(this.render, this.url, PageDensity.SOFT, pageNumber);

            page.load();
            this.pages.push(page);
        }

        this.createSpread();
    }
}

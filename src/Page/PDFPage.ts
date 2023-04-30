import * as pdfjsLib from 'pdfjs-dist/webpack';
import { CanvasRender } from '../Render/CanvasRender';
import { Page, PageDensity, PageOrientation } from './Page';
import { Render } from '../Render/Render';
import { Point } from '../BasicTypes';
import { PDFPageProxy } from '../../../../node_modules/pdfjs-dist/types/web/interfaces';
import { post } from 'jquery';
import { RenderParameters } from '../../../../node_modules/pdfjs-dist/types/src/display/api';

class CachedCanvas
{
    public pageNumber:number;
    public canvas:HTMLCanvasElement;
    public ready:boolean = false;
    public waiting:boolean = false;

    constructor(pageNumber:number, canvas:HTMLCanvasElement) {
        this.pageNumber = pageNumber;
        this.canvas = canvas;
    }
}

/**
 * Class representing a cache of canvases. Canvases are cached in LRU style
 * and when full the cache will return the oldest canvas in the cache to reuse.
 */
class CanvasCache
{
    private static CACHE_SIZE:number = 10;
    private cache:CachedCanvas[] = [];

    constructor() {
        for (let i = 0; i < CanvasCache.CACHE_SIZE; i++) {
            const canvas = document.createElement("canvas");
            canvas.id = `canvas-${i}`;
            this.cache.push(new CachedCanvas(0, canvas));
        }
    }

    invalidateCache() {
        for (var cachedCanvas of this.cache) {
            cachedCanvas.pageNumber = 0;
        }        
    }

    getCanvas(pageNumber:number): CachedCanvas {
        // Get the canvas assigned to the page number
        // or if it doesn't exist, get the last recently
        // used one from the cache.
        for (let i = 0; i < this.cache.length; ++i)
        {
            const cachedCanvas:CachedCanvas = this.cache[i];
            if (cachedCanvas.pageNumber == pageNumber)
            {
                // Most recently used is at end
                this.cache.push(cachedCanvas);
                this.cache.splice(i, 1);
                return cachedCanvas;
            }
        }

        // Oldest one is at the start
        const cachedCanvas:CachedCanvas = this.cache[0];
        cachedCanvas.pageNumber = pageNumber;
        cachedCanvas.ready = false;
        cachedCanvas.waiting = false;
        // Most recently used is at end
        this.cache.push(cachedCanvas);
        this.cache.shift();
 
        return cachedCanvas;
    }
}

/**
 * A PDF page rendering job
 */
class RenderJob
{
    public page: PDFPageProxy;
    public renderContext: RenderParameters;
    public postRenderCb: any;

    constructor(page: PDFPageProxy, renderContext: RenderParameters, postRenderCb: any)
    {
        this.page = page;
        this.renderContext = renderContext;
        this.postRenderCb = postRenderCb;
    }
}

/**
 * Queue of PDF page rendering requests. Whenver a page is queued the 
 * current queue is drained (with async render calls).
 */
class RenderQueue {
    constructor() {}
    private queue: RenderJob[] = [];
    private job: RenderJob = null;

    public enqueue(page: PDFPageProxy, renderContext: RenderParameters, postRenderCb: any)
    {
        this.queue.push(new RenderJob(page, renderContext, postRenderCb));
        this.renderOne();
    }

    private renderOne()
    {
        if (this.job === null && this.queue.length)
        {
            this.job = this.queue.shift();
            this.job.page.render(this.job.renderContext).promise.then(() => {
                this.job.postRenderCb();
                this.job = null;
                this.renderOne();
            })
        }
    }
}

/**
 * Class representing a book page as an image on Canvas
 */
export class PDFPage extends Page {
    private static canvasCache: CanvasCache = new CanvasCache();
    private static renderQueue: RenderQueue = new RenderQueue();
    private static timeout: any = null;

    private isLoaded = false;
    private loadingAngle = 0;
    private loading = false;
    private readonly pageNumber: number;
    private readonly pdfDoc: pdfjsLib.PDFDocumentProxy;
    private pdfPage: pdfjsLib.PDFPageProxy = null;
    private cachedCanvas: CachedCanvas = null;
    private readonly pageFetcher: any;

    constructor(render: Render, pdfDoc: any, density: PageDensity, pageNumber: number, pageFetcher: any) {
        super(render, density);
        this.pageNumber = pageNumber;
        this.pdfDoc = pdfDoc;
        this.pageFetcher = pageFetcher;
    }

    public static windowResized()
    {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => { PDFPage.canvasCache.invalidateCache();}, 500);
    }
  
    // Draws a page being turned.
    public draw(tempDensity?: PageDensity): void {
        const ctx = (this.render as CanvasRender).getContext();

        const pagePos = this.render.convertToGlobal(this.state.position);
        const pageWidth = this.render.getRect().pageWidth;
        const pageHeight = this.render.getRect().height;

        ctx.save();
        ctx.translate(pagePos.x, pagePos.y);
        ctx.beginPath();

        for (let p of this.state.area) {
            if (p !== null) {
                p = this.render.convertToGlobal(p);
                ctx.lineTo(p.x - pagePos.x, p.y - pagePos.y);
            }
        }

        ctx.rotate(this.state.angle);

        ctx.clip();

        if (!this.isLoaded) {
            this.drawLoader(ctx, { x: 0, y: 0 }, pageWidth, pageHeight);
        } else {
            this.renderPage(0, 0, pageWidth, pageHeight, ctx);
        }

        ctx.restore();
    }

    // Draws a turned page
    public simpleDraw(orient: PageOrientation): void {
        const rect = this.render.getRect();
        const ctx = (this.render as CanvasRender).getContext();

        const pageWidth = rect.pageWidth;
        const pageHeight = rect.height;

        const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;

        const y = rect.top;

        if (!this.isLoaded) {
            this.drawLoader(ctx, { x, y }, pageWidth, pageHeight);
        } else {
            this.renderPage(x, y, pageWidth, pageHeight, ctx);
         }
    }

    // Draws a spinning loader icon
    private drawLoader(
        ctx: CanvasRenderingContext2D,
        shiftPos: Point,
        pageWidth: number,
        pageHeight: number
    ): void {
        ctx.beginPath();
        ctx.strokeStyle = 'rgb(200, 200, 200)';
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.lineWidth = 1;
        ctx.rect(shiftPos.x + 1, shiftPos.y + 1, pageWidth - 1, pageHeight - 1);
        ctx.stroke();
        ctx.fill();

        const middlePoint: Point = {
            x: shiftPos.x + pageWidth / 2,
            y: shiftPos.y + pageHeight / 2,
        };

        ctx.beginPath();
        ctx.lineWidth = 10;
        ctx.arc(
            middlePoint.x,
            middlePoint.y,
            20,
            this.loadingAngle,
            (3 * Math.PI) / 2 + this.loadingAngle
        );
        ctx.stroke();
        ctx.closePath();

        this.loadingAngle += 0.07;
        if (this.loadingAngle >= 2 * Math.PI) {
            this.loadingAngle = 0;
        }
    }

    // Load the PDF page
    public load(): void {
        if (!this.isLoaded && !this.loading)
        {
            this.loading = true;

            this.getPage(this.pageNumber).then((pdfPage: pdfjsLib.PDFPageProxy) => {
                this.isLoaded = true;
                this.pdfPage = pdfPage;
            });
        }
    }

    public newTemporaryCopy(): Page {
        return this;
    }

    public getTemporaryCopy(): Page {
        return this;
    }

    public hideTemporaryCopy(): void {
        return;
    }


    ///////////////

    // Return a promise to provide the required page
    private async getPage(num: number): Promise<any> {
        const page: any = await this.pdfDoc.getPage(num);
        return page;
    }

    // Get a canvas with the image rendered into it or return null.
    public getCanvasInitiatingPageRenderIfRequired(pageWidth: number, pageHeight: number, fetchAround: boolean = true): CachedCanvas
    {
        if (this.isLoaded)
        {
            const cachedCanvas:CachedCanvas = PDFPage.canvasCache.getCanvas(this.pageNumber);
            if (cachedCanvas.ready)
            {
                if (fetchAround) this.prepopulateCacheAroundThisPage(pageWidth, pageHeight);
                return cachedCanvas;
            }
            else if (!cachedCanvas.waiting)
            {
                // Have to draw into canvas
                this.cachedCanvas = cachedCanvas;
                const canvas = this.cachedCanvas.canvas;
                canvas.width = pageWidth;
                canvas.height = pageHeight;
                const canvasContext:CanvasRenderingContext2D = canvas.getContext("2d");

                var unscaledViewport = this.pdfPage.getViewport({scale: 1.0});
                const unscaledHeight = unscaledViewport.height;
                const unscaledWidth = unscaledViewport.width;
                var scale = Math.min((pageHeight / unscaledHeight), (pageWidth / unscaledWidth));
                const renderContext = {
                    canvasContext: canvasContext,
                    viewport: this.pdfPage.getViewport({scale: scale})
                };
                cachedCanvas.waiting = true;
                PDFPage.renderQueue.enqueue(this.pdfPage, renderContext, () => {
                    cachedCanvas.waiting = false;
                    cachedCanvas.ready = true;
                });

                if (fetchAround) this.prepopulateCacheAroundThisPage(pageWidth, pageHeight);
            }
        }
        return null;
    }

    // Render the page to the context if there's a populated cache entry. Otherwise, don't do this
    // draws a repeatedly called and we'll be asked again very shortly, but which time we should
    // have cached image to return
    private renderPage(x: number, y: number, pageWidth: number, pageHeight: number,
        ctx: CanvasRenderingContext2D)
    {
        const cachedCanvas:CachedCanvas = this.getCanvasInitiatingPageRenderIfRequired(pageWidth, pageHeight);
        if (cachedCanvas !== null)
        {
            ctx.drawImage(cachedCanvas.canvas, x, y);
        }
    }


    // Fetch 2 pages before and two after so we're always ready to turn the next page.
    private prepopulateCacheAroundThisPage(pageWidth: number, pageHeight: number)
    {
        for (var nextPage of [
                                this.pageFetcher(this.pageNumber - 2),
                                this.pageFetcher(this.pageNumber - 1),
                                this.pageFetcher(this.pageNumber + 1),
                                this.pageFetcher(this.pageNumber + 2)
                            ]) {
            if (nextPage) {
                nextPage.getCanvasInitiatingPageRenderIfRequired(pageWidth, pageHeight, false);
            }
        }
    }

}

import * as pdfjsLib from 'pdfjs-dist/webpack';
import { CanvasRender } from '../Render/CanvasRender';
import { Page, PageDensity, PageOrientation } from './Page';
import { Render } from '../Render/Render';
import { Point } from '../BasicTypes';

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
 * Class representing a cache of canvases
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
 * Class representing a book page as an image on Canvas
 */
export class PDFPage extends Page {
    static canvasCache: CanvasCache = new CanvasCache();
    private isLoad = false;

    private loadingAngle = 0;
    private loading = false;
    private readonly pageNumber: number;
    private readonly pdfDoc: pdfjsLib.PDFDocumentProxy;
    private pdfPage: pdfjsLib.PDFPageProxy = null;
    private cachedCanvas: CachedCanvas = null;

    constructor(render: Render, pdfDoc: any, density: PageDensity, pageNumber: number) {
        super(render, density);
        this.pageNumber = pageNumber;
        this.pdfDoc = pdfDoc;
    }

    public static windowResized()
    {
        PDFPage.canvasCache.invalidateCache();
    }
  
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

        if (!this.isLoad) {
            this.drawLoader(ctx, { x: 0, y: 0 }, pageWidth, pageHeight);
        } else {
            this.renderPage(0, 0, pageWidth, pageHeight, ctx);
        }

        ctx.restore();
    }

    public simpleDraw(orient: PageOrientation): void {
        const rect = this.render.getRect();
        const ctx = (this.render as CanvasRender).getContext();

        const pageWidth = rect.pageWidth;
        const pageHeight = rect.height;

        const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;

        const y = rect.top;

        if (!this.isLoad) {
            this.drawLoader(ctx, { x, y }, pageWidth, pageHeight);
        } else {
            this.renderPage(x, y, pageWidth, pageHeight, ctx);
         }
    }

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

    private renderPage(x: number, y: number, pageWidth: number, pageHeight: number,
                       ctx: CanvasRenderingContext2D)
    {
        const cachedCanvas:CachedCanvas = this.getCanvasInitiatingPageRenderIfRequired(pageWidth, pageHeight);
        if (cachedCanvas !== null)
        {
            ctx.drawImage(cachedCanvas.canvas, x, y);
        }
    }

    public getCanvasInitiatingPageRenderIfRequired(pageWidth: number, pageHeight: number): CachedCanvas
    {
        if (this.isLoad)
        {
            const cachedCanvas:CachedCanvas = PDFPage.canvasCache.getCanvas(this.pageNumber);
            if (cachedCanvas.ready)
            {
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
                var scale = Math.min((pageHeight / unscaledViewport.height), (pageWidth / unscaledViewport.width));
                const renderContext = {
                    canvasContext: canvasContext,
                    viewport: this.pdfPage.getViewport({scale: scale})
                };
                
                this.pdfPage.render(renderContext).promise.then(() => {
                    cachedCanvas.waiting = false;
                    cachedCanvas.ready = true;  
                });
            }
        }
        return null;
    }

    // Return a promise to provide the required page
    async getPage(num: number): Promise<any> {
        const page: any = await this.pdfDoc.getPage(num);
        return page;
    }

    public load(): void {
        if (!this.isLoad && !this.loading)
        {
            this.loading = true;

            this.getPage(this.pageNumber).then((pdfPage: pdfjsLib.PDFPageProxy) => {
                this.isLoad = true;
                this.pdfPage = pdfPage;
                const vp = pdfPage.getViewport({scale: 1.0});
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
}

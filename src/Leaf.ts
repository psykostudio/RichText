import { Glyph, Font, Path } from "opentype.js";
import { FontStyle, TokenAttributes } from "./formater";

export enum LeafType {
  Space = "Space",
  NewLine = "NewLine",
  Tabulation = "Tabulation",
  Word = "Word",
  Glyph = "Glyph",
  Image = "Image"
}

export class Leaf {
  public text: string;
  public token;
  public children: Leaf[] = [];
  public glyph: Glyph;
  public style: FontStyle;
  public font: Font;
  public fontSize: number;
  public fontRatio: number;
  private _x: number = 0;
  private _y: number = 0;
  public width: number;
  public height: number = 0;
  public type: LeafType;
  public path: Path;
  public attributes: TokenAttributes;
  public image: HTMLImageElement;
  public baseLine: number;
  renderer;

  private _previous: Leaf = null;
  private _next: Leaf = null;
  private _parent: Leaf;

  constructor(text: string, token, renderer, parent?: Leaf, previous?: Leaf) {
    this.text = text;
    this.token = token;
    this.style = this.token[`style`];
    this.attributes = this.token[`attributes`];
    this.renderer = renderer;
    this.parent = parent;
    this.previous = previous;
    
    this.font = this.style.font;
    this.fontSize = Math.round(this.style.fontSize);
    this.fontRatio = (1 / this.font.unitsPerEm) * this.fontSize;
    this.baseLine = this.font.ascender * this.fontRatio;
  
    this.identify();
  }

  private identify() {
    if (this.text.length > 1) {
      this.type = LeafType.Word;
      this.splitInGlyphs();
    } else {
      if (this.token.name === "img") {
        this.type = LeafType.Image;
        this.width = this.attributes.getByName("width").asInteger;
        this.height = this.attributes.getByName("height").asInteger;
      } else {
        switch (this.text) {
          case " ":
            this.type = LeafType.Space;
            break;
          case "\t":
            this.type = LeafType.Tabulation;
            break;
          case "\r":
          case "\n":
            this.type = LeafType.NewLine;
            break;
          default:
            if (this.text.length === 1) {
              this.type = LeafType.Glyph;
            }
            break;
        }

        this.buildGlyph();
      }
    }
  }

  public drawImage(context: CanvasRenderingContext2D) {
    const drawPosition = {
      x: Math.round(this.x),
      y: Math.round(this.y - this.baseLine),
    }

    if (!this.image) {
      this.loadImage(() => {
        this.image.width = this.width;
        this.image.height = this.height;
        context.drawImage(
          this.image,
          drawPosition.x,
          drawPosition.y,
          this.width,
          this.height
        );
      });
    } else {
      this.image.width = this.width;
      this.image.height = this.height;
      context.drawImage(
        this.image,
        drawPosition.x,
        drawPosition.y,
        this.width,
        this.height
      );
    }
  }

  private loadImage(cb: () => void) {
    this.image = new Image();
    this.image.src = this.attributes.getByName("src").value;
    this.image.onload = cb;
  }

  public draw(context: CanvasRenderingContext2D) {
    context.beginPath();

    for (let i = 0; i < this.path.commands.length; i += 1) {
      const cmd = this.path.commands[i];
      if (cmd.type === "M") {
        context.moveTo(cmd.x, cmd.y);
      } else if (cmd.type === "L") {
        context.lineTo(cmd.x, cmd.y);
      } else if (cmd.type === "C") {
        context.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
      } else if (cmd.type === "Q") {
        context.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
      } else if (cmd.type === "Z") {
        context.closePath();
      }
    }
  }

  public getPath(): Path {
    if (this.children.length > 0) {
      this.path = new Path();
      this.children.forEach(child => {
        this.path.extend(child.getPath());
      });
    } else if (this.type !== LeafType.Image) {
      this.path = (this.glyph as any).getPath(
        this.roundedPosition.x,
        this.roundedPosition.y,
        this.fontSize,
        this.renderer.renderOptions,
        this.font
      );
    }

    return this.path;
  }

  public get roundedPosition(){
    return {
      x: Math.round(this.x),
      y: Math.round(this.y),
    }
  }

  private getGlyphBound() {
    if (
      this.renderer.renderOptions.kerning &&
      this.previous &&
      this.previous.glyph
    ) {
      const kerning = this.font.getKerningValue(
        this.previous.glyph,
        this.glyph
      );
      this.previous.glyph.advanceWidth += kerning;
    }

    const width = this.glyph.advanceWidth * this.fontRatio;
    const yDiff = this.glyph[`yMax`] - this.glyph[`yMin`];
    const height = isNaN(yDiff) ? 0 : yDiff * this.fontRatio;

    return { width, height };
  }

  private buildGlyph() {
    this.glyph = this.font.charToGlyph(this.text);
    const bounds = this.getGlyphBound();
    this.width = bounds.width;
    this.height = bounds.height;
  }

  private splitInGlyphs() {
    const chars = this.text.split("");
    let totalWidth: number = 0;

    chars.forEach((char: string, index: number) => {
      const child = new Leaf(char, this.token, this.renderer);
      child.previous = this.children[index - 1];
      child.parent = this;
      child.x = totalWidth;
      totalWidth += child.width;
      this.height = Math.max(this.height, child.height);
      this.addChild(child);
    });

    this.width = totalWidth;
  }

  public addChild(childs: Leaf | Leaf[]) {
    if (Array.isArray(childs)) {
      childs.forEach(child => {
        this.addChild(child);
      });
    } else {
      this.children.push(childs);
    }
  }

  public set parent(value: Leaf) {
    this._parent = value;

    if (!this.previous && this.parent) {
      this.previous = this.parent.previous;
    }
  }

  public get parent() {
    return this._parent;
  }

  public set previous(value: Leaf) {
    this._previous = value;

    if (this._previous) {
      this._previous.next = this;
    }
  }

  public get previous() {
    return this._previous;
  }

  public set next(value: Leaf) {
    this._next = value;
  }

  public get next() {
    return this._next;
  }

  public set x(value: number) {
    this._x = value;
  }

  public get x() {
    return this._x + (this.parent ? this.parent.x : 0);
  }

  public set y(value: number) {
    this._y = value;
  }

  public get y() {
    return this._y + (this.parent ? this.parent.y : 0);
  }
}
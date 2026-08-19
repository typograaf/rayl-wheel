import * as THREE from "three";
import { CARD_ASPECT } from "./card.js";
import { cardTile } from "./cardart.js";

/**
 * The wheel: a list of cards mounted round the outside of a drum.
 *
 * The drum lies across the frame with its axis horizontal, so scrolling turns
 * it and the cards ride up and over. Card `i` sits (scroll - i) steps round
 * from the front, and the front is the middle of the picture — so the number in
 * the scroll is which card is being looked at, and the fraction is how far it
 * has been dragged towards the next one.
 *
 * That sign is the whole of which way a list runs: at rest the first card is in
 * the middle and everything after it hangs below, the way a page of anything
 * does, and turning the wheel forwards brings the next one up rather than
 * fetching the last one back.
 *
 * The drum is placed so its front is at the origin rather than its centre. Both
 * cameras then look at the origin and the card at rest is the same size under
 * either of them, which is the whole point of offering the two.
 *
 * Nothing is drawn on the far side. A drum is a loop and a list is not, so a
 * card that has been scrolled past has gone rather than come round: past the
 * arc it is switched off, and for the last few degrees before that it fades, so
 * it leaves rather than blinks. That also means the list can be longer than the
 * drum's own circumference without cards colliding with themselves on the far
 * side, which is the thing that makes a wheel a carousel and not a list.
 */

/* The card, as the model has it: one unit across and this much down. */
export const CARD_HEIGHT = 1 / CARD_ASPECT;

const RADIANS = Math.PI / 180;

/**
 * One card's material: the print laid into the surface, on one face.
 *
 * The sheet is shared and the card's own place on it is a uniform, so six
 * designs and a dozen cards are one texture and one program. The `paint`
 * attribute out of the model decides where the ink is allowed to land — the
 * front face and nothing else, so the back and the rim stay the colour of the
 * card.
 */
function cardMaterial(atlas, tile) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xe9e9e2,
    roughness: 0.55,
    metalness: 0,
    sheen: 0.5,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(0xffffff),
    clearcoat: 0,
    clearcoatRoughness: 0.4,
    map: atlas,
  });

  material.userData.tile = { value: new THREE.Vector4(...tile) };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = material.userData.tile;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float paint;\nvarying float vPaint;",
      )
      .replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\n\tvPaint = paint;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec4 uTile;\nvarying float vPaint;",
      )
      /*
       * Laid into the colour rather than multiplied over it.
       *
       * The sheet is ink on nothing: its alpha is where a mark is and its rgb
       * is the colour that mark was drawn at. Multiplying would tint the card
       * everywhere the sheet is clear; mixing puts the design's own grey on
       * the card and leaves the rest of it alone.
       */
      .replace(
        "#include <map_fragment>",
        `vec4 print = texture2D(map, vMapUv * uTile.xy + uTile.zw);
        diffuseColor.rgb = mix(diffuseColor.rgb, print.rgb, print.a * vPaint);`,
      );
  };
  /* Every card compiles to the same program, and it is not the stock one. */
  material.customProgramCacheKey = () => "rayl-card-print";
  return material;
}

export class Wheel {
  constructor(scene, geometry, atlas) {
    this.scene = scene;
    this.geometry = geometry;
    this.atlas = atlas;
    this.cards = [];
  }

  /** As many cards as the panel asks for, each with its own design. */
  setCount(count) {
    while (this.cards.length > count) {
      const card = this.cards.pop();
      this.scene.remove(card);
      card.material.dispose();
    }
    while (this.cards.length < count) {
      const i = this.cards.length;
      const card = new THREE.Mesh(
        this.geometry,
        cardMaterial(this.atlas, cardTile(i)),
      );
      card.castShadow = true;
      card.receiveShadow = true;
      this.cards.push(card);
      this.scene.add(card);
    }
  }

  /** The colour and finish of every card, which is one surface and not many. */
  setSurface({ colour, roughness, sheen, coat }) {
    for (const card of this.cards) {
      card.material.color.set(colour);
      card.material.roughness = roughness;
      card.material.sheen = sheen;
      card.material.clearcoat = coat;
    }
  }

  /**
   * Where every card is, at this scroll.
   *
   * `radius` and `spacing` are both in cards: how many card-heights across the
   * drum is, and how much clear air there is between one card and the next
   * along its surface. Read that way the two are independent — a wider drum at
   * the same spacing is a flatter run of the same list, rather than the same
   * curve with the cards further apart.
   */
  update({ radius, spacing, arc, fade, scroll, thickness, cycle }) {
    const R = Math.max(radius, 0.2) * CARD_HEIGHT;
    const step = (CARD_HEIGHT * (1 + spacing)) / R;
    const limit = arc * RADIANS;
    const soft = Math.max(fade * RADIANS, 1e-4);
    const count = this.cards.length;

    for (let i = 0; i < count; i++) {
      const card = this.cards[i];
      /*
       * Cycling, a card stands at its nearest repeat rather than at its one
       * place in the list — which is what makes a finite list endless without
       * a second set of cards to draw. The arc holds five or six of them and
       * there are a dozen, so the nearest repeat is the only one that could be
       * on screen anyway.
       */
      const place = cycle ? i + Math.round((scroll - i) / count) * count : i;
      const theta = (scroll - place) * step;
      if (Math.abs(theta) >= limit) {
        card.visible = false;
        continue;
      }
      card.visible = true;
      card.position.set(0, R * Math.sin(theta), R * Math.cos(theta) - R);
      card.rotation.x = -theta;
      card.scale.z = thickness;

      const over = Math.abs(theta) - (limit - soft);
      const opacity = over <= 0 ? 1 : Math.max(0, 1 - over / soft);
      card.material.opacity = opacity;

      /*
       * And the material is told when that changes it from solid to not.
       *
       * `transparent` is not a switch three reads at draw time: it is baked
       * into the program as OPAQUE, which makes the shader write an alpha of
       * one whatever the opacity says. Flipped without asking for a recompile,
       * a card that has started to fade goes on being drawn by the program it
       * was solid under — and it stays solid, at the edge of the arc, where the
       * whole point of it is to leave. Only on the change, because a recompile
       * every frame is a recompile every frame.
       */
      const veiled = opacity < 0.999;
      if (card.material.transparent !== veiled) {
        card.material.transparent = veiled;
        card.material.needsUpdate = true;
      }
      /* A card that has faded out casts no shadow either, or the light shows
         something the picture does not. */
      card.castShadow = opacity > 0.02;
    }
    this.step = step;
  }

  /** How many steps of scroll there are, end to end. */
  span() {
    return Math.max(this.cards.length - 1, 0);
  }
}

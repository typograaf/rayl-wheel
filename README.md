# Rayl Wheel

A list of cards on a drum, turned by scrolling, in a browser tab.

    npm install
    npm run dev     # the tool
    npm test        # the suite, on the real GPU

The picture is 330 by 472 — the scroller's own box in the design — and stays
that shape whatever the window does. A tool for deciding how something looks in
a phone that showed it in a letterbox would be answering a different question.

Cut down from [rayl-stack](../rayl-stack), which is the same principles at ten
times the size: a deferred renderer, a subsurface chain, light handles, a plan,
an export, and a macOS app around all of it. None of that is here. What came
across is the interface — the short panel, at node 735:12902's measurements —
the backdrop, and the habit of taking numbers off the file rather than judging
them by eye.

## The wheel

The drum lies across the frame with its axis horizontal, so scrolling turns it
and the cards ride up and over. Card `i` sits (scroll - i) steps round from the
front, and the front is the middle of the picture — so the whole number in the
scroll is which card is being looked at and the fraction is how far it has been
dragged towards the next one.

That sign is the whole of which way a list runs. At rest the first card is in the
middle and everything after it hangs below, the way a page of anything does, and
turning the wheel forwards brings the next one up rather than fetching the last
one back.

**Radius and spacing are both measured in cards**: how many card-heights across
the drum is, and how much clear air there is between one card and the next along
its surface. Read that way the two are independent — a wider drum at the same
spacing is a flatter run of the same list, rather than the same curve with the
cards further apart. The step between two cards is then arc length over radius,
which is why widening the drum brings more of the list into the frame without
touching how tightly it is packed.

The design's own proportions come out at a radius of about 1.7 and a spacing of
0.1, which is where this opens.

## Nothing at the back

A drum is a loop and a list is not.

Past the arc a card is switched off, and for the last few degrees before that it
fades, so it leaves rather than blinks. Which is what makes a wheel a carousel
and not a barrel: the list can be longer than the drum's own circumference
without cards colliding with themselves on the far side, and scrolling past the
end of it shows the end of it rather than the start coming round.

The test checks this the way the requirement is written — no visible card is
further from the camera than the drum's own centre — at three settings of radius
and arc, including the tightest drum the panel can ask for.

## The two projections

Which one this wants is a question the design has not answered, so both are here
and they are told the same thing: how much of the frame's width a card at rest is
allowed to take.

That number is what makes them comparable. The card at rest is at the origin and
both cameras are square on to it, so it comes out the same size under either, and
**everything that differs between them is what the rest of the wheel does**.
Under the lens the drum recedes and the cards away from the middle get smaller as
well as shallower. Flat, they keep their width and only foreshorten — which is
the right-hand phone in node 800:6537 exactly.

Lens goes away when the projection is flat, because a parallel projection has no
focal length to set and a control that does nothing is worse than no control.

## The card

Modelled, not extruded here: `UI Card.blend`, the design's rounded rectangle
subdivided, so the corners and the bevel are geometry rather than a normal map
pretending. It arrives lying flat with its thickness on y, which is the
exporter's habit and not a decision, so the first thing done to it is to stand it
up — long side across, short side up, thickness towards the camera — and scale it
so the long side is exactly one unit. Every distance in the wheel is then a share
of a card.

Three things are settled on the way out of Blender rather than worked around
here. The mirror it was built with leaves half the faces wound inside-out, so
the normals are made consistent before export — without which the face nearest
the camera is the card's back, and the print lands on the side nobody can see.
The object's own scale is baked into the mesh, because it stopped being uniform
when the card was thickened and dropping it would have kept the outline and lost
the depth. And a dissolve at one degree takes the subdivided mesh from tens of
thousands of triangles to seventeen hundred without touching the silhouette,
because most of a card is flat and a flat face does not need geometry to say so.
39KB.

Re-exported from the blend with `blender -b "UI Card.blend" --python`: one
script, three steps and no hand editing, so the next revision of the card is one
command rather than an afternoon.

## The print

Node 800:6538, drawn into one sheet — six cards, three across and two down, every
measurement and string in the design's own units and scaled once on the way to
the canvas.

Drawn rather than exported, for the reason a texture is usually exported:
resolution. A card is 330 across in the design and can be most of a retina frame
here, and a flat PNG of one would be soft long before that. This is redrawn at
whatever size it is asked for, in the same Azeret the panel is set in — which
also means the type is _measured_ rather than assumed: the left column is as wide
as its own longest line, so a longer job title moves the block beside it instead
of running under it.

**The icons are the size they were cut at, times four fifths** — node 800:8147,
where all six are shown on the same card and every one comes out at exactly 0.8
of its own artboard. They are not one size and must not be made one: a 24x10
mark and a 16x16 mark are different drawings, and normalising them to a common
height is the sort of tidying that quietly redraws somebody's artwork.

Which leaves one thing the design does that a single model cannot. There the
card is cut to its contents, so an icon two points shorter makes a card two
points shorter; here there is one card and it is one height. So what the design
does by resizing the card, this does by centring the block in it — the same
distances in the same order, and no card riding high because its icon happens to
be a flat one.

It comes out on nothing. The card is not drawn, only the marks on it, so the
sheet's alpha is where the ink is and the card underneath goes on being a
material you can dial. On the card the print is laid into the surface colour and
lit with it, so a card tilting away carries its design into the shade with it,
which is what the design's own far cards do.

One side only, and it is the side that faces you at rest — decided by a `paint`
attribute built with the model, from how steeply a face lies and which side of
the card it is on. The back stays blank and the rim stays the colour of the card,
because that is what a printed card is.

## The room

Drawn rather than downloaded.

The long tool lights its stack with a photographed studio: sixteen hundred
kilobytes of HDR before a single pixel is on screen, which is the right trade for
something that renders a still to six thousand pixels and the wrong one for
something that has to be up in a page. The room here is a canvas — a
floor-to-ceiling ramp with a soft key burnt into it, blurred into an irradiance
map the way an HDR would be. It weighs nothing, it comes up in a frame, and
because it is generated the rig can _move_ the key rather than choosing between
two photographs of somebody else's.

Three rigs, and how hard each one is. The room does the shading and a single lamp
does the shadow, both from the same place — a card lit from above and shadowed
from the side is two lights telling two different stories, and the eye finds it
before it can say why.

The backdrop is the design's own gradient, `#81817b` to `#dbdbd2`, straight down
the frame. It is the sheet the cards are photographed against, and a sheet does
not change when you move a light: only the cards do.

## The panel

The short one — everything the long tool offers behind a mode switch, and nothing
else. Which is the whole point of a tool cut down to one question: there is no
long panel to switch to, so the rows are authored short rather than moved there
at startup, and the file is a fifth of the size for it.

Every number is a label on the left and a 170x12 track on the right with its
value riding in a nub — the design's Union path, generated rather than used as
the exported asset, because in the design every slider reads zero and the nub
sits at the head, and on a live one it has to travel. Every choice is a row of
buttons rather than a dropdown: every option visible, one click to any of them,
and no menu opening over the thing you are looking at.

## Turning it

The wheel, a drag anywhere in the picture, or the panel's own slider. All three
write the same one number and the picture follows it at its own pace, so a flick
of the trackpad and a drag of the slider arrive the same way — which makes the
motion a property of the wheel rather than of whichever thing happened to be
touched. Snapping is what happens when nothing else is: a card the scroll was
left near becomes the card it is on, once the hand is off it.

Nothing renders unless something moved.

## The loop

Or it turns itself. Play — or space — runs the wheel through a travel measured
in cards, over a duration measured in seconds, on one of the three curves the
short panel offers: in and out, out and in, or straight. The same control points
the long tool's editor holds, offered as three buttons, because this is a tool
for deciding how a wheel turns and not for authoring an easing.

No spring while it runs. A spring is a transient and a transient in a loop is a
seam, so the clock says where the wheel is outright — the same answer for the
picture on screen and for the frame being encoded, which are one animation saved
two ways. A hand on the wheel takes it off the loop, because two things driving
one number is one thing too many and the one you are holding should win.

**Ping-pong** runs out and back along a list that ends, and closes whatever it
travels: it finishes where it turned round from. **Cycle** makes the list a
ring — a card stands at its nearest repeat, so the wheel can be turned for as
long as you like — and closes when the travel is a multiple of six, because the
sheet holds six designs and six along is the same six cards in the same places.
Which is why it opens at six. Five along is a loop with a jump in it, and the
suite checks both halves of that so it stays true.

Asking that question found a real bug, too. `transparent` is baked into three's
shader program as OPAQUE, so a card that started to fade without asking for a
recompile went on being drawn solid at the edge of the arc, at whatever opacity
it claimed. It looked right in every still. It only showed up as a loop that
would not close.

## Getting it out

A still or the loop, at whatever width is asked for — the height follows, since
the frame has one shape and a height that disagreed with it would be a letterbox
around the thing being judged.

**The still comes out on nothing.** Which is the point of exporting one: it goes
into a layout, over a colour somebody else picks. The backdrop is in the picture
on screen because that is what the cards are photographed against, and out of the
file because a background baked into a PNG is a background you cannot take off.
The video keeps it — H.264 has no alpha to carry, so a frame has to arrive
already sitting on something.

The loop is stepped at a fixed 1/fps and handed to the browser's own H.264
encoder frame by frame, rather than recorded off the wall clock: the file holds
the motion that was authored instead of whatever the machine managed to paint.
See record.js, where the argument against MediaRecorder is made properly. A
second press of the button cancels.

## The link

Every control writes itself into the address bar, so a reload comes back to the
picture that was on screen and a link is a look somebody else can open.

Everything goes in, including whatever happens to be at its default — a string
that carries only what was changed reads better and means less, since the day a
default moves, every link written before it quietly becomes a different picture.
It is read back forgivingly, though: each value is checked against the control
that owns it, so a link cannot ask for a count of nine thousand or a rig nobody
built, and one stale key does not take the rest of the string down with it.

Written on a debounce and with `replaceState`, so dragging a slider leaves one
entry in the address bar rather than two hundred in the back button.

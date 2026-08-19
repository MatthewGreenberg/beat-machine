import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { tutorialLive } from '../ui/tutorial-live'

// Sits inside the Rig group and, when the tutorial has a target, projects its
// machine-local rect (or a DOM element's rect) to screen px every frame,
// moving the spotlight hole imperatively — so the cutout rides the pointer
// parallax instead of pointing at where the machine used to be.
const v = new THREE.Vector3()
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]

export default function TutorialAnchor() {
  const group = useRef()
  const { camera, size } = useThree()
  // Damped current box so step changes glide instead of jump-cutting.
  const cur = useRef(null)

  useFrame((_, dt) => {
    const { hole, target } = tutorialLive
    if (!hole || !group.current) return
    if (!target) { cur.current = null; return }

    let minX, minY, maxX, maxY
    if (target.dom) {
      const el = document.querySelector(target.dom)
      if (!el) return
      const r = el.getBoundingClientRect()
      minX = r.left; minY = r.top; maxX = r.right; maxY = r.bottom
    } else {
      minX = minY = Infinity
      maxX = maxY = -Infinity
      for (const [dx, dy] of CORNERS) {
        v.set(target.x + (dx * target.w) / 2, target.y + (dy * target.h) / 2, target.z ?? 1.1)
          .applyMatrix4(group.current.matrixWorld)
          .project(camera)
        const px = (v.x * 0.5 + 0.5) * size.width
        const py = (0.5 - v.y * 0.5) * size.height
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
      }
    }

    const pad = target.pad ?? 12
    const box = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
    const c = cur.current ?? (cur.current = { ...box })
    const k = 1 - Math.exp(-12 * Math.min(dt, 0.05))
    c.x += (box.x - c.x) * k
    c.y += (box.y - c.y) * k
    c.w += (box.w - c.w) * k
    c.h += (box.h - c.h) * k
    hole.style.transform = `translate(${c.x}px, ${c.y}px)`
    hole.style.width = `${c.w}px`
    hole.style.height = `${c.h}px`
  })

  return <group ref={group} />
}

/**
 * Score a candidate reply by keyword surprise (Shannon entropy of keywords in context).
 *
 * @param {import('./model.js').BidirectionalModel} model
 * @param {string[]} candidate - Tokens of the candidate reply
 * @param {Set<string>} keywords - Set of uppercase keywords
 * @returns {number}
 */
export function evaluateReply(model, candidate, keywords) {
  if (!candidate || candidate.length === 0) {
    return 0.0;
  }

  let entropy = 0.0;
  let num = 0;

  // Forward evaluation.
  const fwdCtx = model.forwardContext();
  for (const token of candidate) {
    const symId = model.dictionary.find(token);
    if (symId === undefined) {
      continue;
    }

    const upperToken = token.toUpperCase();
    if (keywords.has(upperToken)) {
      let probability = 0.0;
      let ctxCount = 0;

      for (let j = 0; j < model.order; j++) {
        const parentRef = fwdCtx.atDepth(j);
        if (parentRef !== null && parentRef !== undefined) {
          const childRef = model.forward.findChild(parentRef, symId);
          if (childRef !== undefined) {
            const childNode = model.forward.node(childRef);
            const parentNode = model.forward.node(parentRef);
            if (parentNode.usage > 0) {
              probability += childNode.count / parentNode.usage;
              ctxCount++;
            }
          }
        }
      }

      if (ctxCount > 0) {
        entropy -= Math.log(probability / ctxCount);
      }
      num++;
    }

    fwdCtx.advance(model.forward, symId);
  }

  // Backward evaluation.
  const bwdCtx = model.backwardContext();
  for (let i = candidate.length - 1; i >= 0; i--) {
    const token = candidate[i];
    const symId = model.dictionary.find(token);
    if (symId === undefined) {
      continue;
    }

    const upperToken = token.toUpperCase();
    if (keywords.has(upperToken)) {
      let probability = 0.0;
      let ctxCount = 0;

      for (let j = 0; j < model.order; j++) {
        const parentRef = bwdCtx.atDepth(j);
        if (parentRef !== null && parentRef !== undefined) {
          const childRef = model.backward.findChild(parentRef, symId);
          if (childRef !== undefined) {
            const childNode = model.backward.node(childRef);
            const parentNode = model.backward.node(parentRef);
            if (parentNode.usage > 0) {
              probability += childNode.count / parentNode.usage;
              ctxCount++;
            }
          }
        }
      }

      if (ctxCount > 0) {
        entropy -= Math.log(probability / ctxCount);
      }
      num++;
    }

    bwdCtx.advance(model.backward, symId);
  }

  // Length penalty.
  if (num >= 8) {
    entropy /= Math.sqrt(num - 1);
  }
  if (num >= 16) {
    entropy /= num;
  }

  return entropy;
}

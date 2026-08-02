import {selection} from "../../../d3-selection/src/index.js";

var Selection = selection.prototype.constructor;

export default function() {
  return new Selection(this._groups, this._parents);
}

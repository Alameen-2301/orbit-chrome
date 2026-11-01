export function storageArea(initial = {}) {
  const values=structuredClone(initial);
  return {
    values, access: null,
    async setAccessLevel({accessLevel}) {this.access=accessLevel;},
    async get(keys) {
      if(keys==null)return structuredClone(values);
      const list=typeof keys==='string'?[keys]:keys;
      return Object.fromEntries(list.filter(k=>k in values).map(k=>[k,structuredClone(values[k])]));
    },
    async set(items) {Object.assign(values,structuredClone(items));},
    async remove(keys) {for(const key of typeof keys==='string'?[keys]:keys)delete values[key];},
  };
}

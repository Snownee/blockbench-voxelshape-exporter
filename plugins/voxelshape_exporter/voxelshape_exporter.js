/// <reference path="../../types/index.d.ts" />

(function() {

	var storageKey = 'voxelshape_exporter.mappings';
	var versionStorageKey = 'voxelshape_exporter.version';

	var styles;
	var skippedRotatedCubes = 0;
	var addedBoxes = [];

	var dialogStyles = `
		.voxelshape-dialog {
			height: 35em;
		}
		.voxelshape-dialog .dialog_wrapper {
			display: flex;
			flex-direction: column;
			min-height: 0;
		}
		.voxelshape-dialog .dialog_content {
			display: flex;
			flex-direction: column;
			flex: 1 1 auto;
			min-height: 0;
			max-height: none;
			overflow: hidden;
		}
		.voxelshape-dialog .dialog_content > * {
			flex: 0 0 auto;
		}
		.voxelshape-dialog .voxelshape-output {
			display: flex;
			flex-direction: column;
			flex: 1 1 auto;
			min-height: 0;
		}
		.voxelshape-dialog #code-view-output {
			flex: 1 1 auto;
			min-height: 0;
			height: auto;
		}
		.voxelshape-dialog #code-view-output .prism-editor-wrapper {
			height: 100%;
		}
		.voxelshape-dialog .voxelshape-warning {
			flex: 0 0 auto;
			display: flex;
			align-items: center;
			gap: 4px;
			margin-top: 10px;
			color: var(--color-light);
		}
		.voxelshape-dialog .voxelshape-copy {
			flex: 0 0 auto;
			width: 100%;
			margin-top: 10px;
		}
	`;

	var Mappings = {
		mojmaps: {
			createCube: 'Block.box',
			cube: 'Block.cube',
			column: 'Block.column',
			boxZ: 'Block.boxZ',
			union: 'Shapes.or',
			combine: 'VoxelShapes.join',
			booleanFunction: 'IBooleanFunction',
		},
		mcp: {
			createCube: 'Block.makeCuboidShape',
			union: 'VoxelShapes.or',
			combine: 'VoxelShapes.combineAndSimplify',
			booleanFunction: 'IBooleanFunction',
		},
		yarn: {
			createCube: 'Block.createCuboidShape',
			cube: 'Block.createCubeShape',
			column: 'Block.createColumnShape',
			boxZ: 'Block.createCuboidZShape',
			union: 'VoxelShapes.union',
			combine: 'VoxelShapes.combineAndSimplify',
			booleanFunction: 'BooleanBiFunction',
		},
		parchment: {
			createCube: 'Block.box',
			cube: 'Block.cube',
			column: 'Block.column',
			boxZ: 'Block.boxZ',
			union: 'Shapes.or',
			combine: 'Shapes.join',
			booleanFunction: 'BooleanOp',
		},
	};

	var exportVoxelShapeAction = new Action({
		id: 'voxelshape_exporter.export',
		name: 'Export VoxelShape',
		icon: 'flip_to_back',
		description: 'Export a VoxelShape',
		category: 'file',
		condition: () => Format.id === 'java_block',
		click: function() {
			showVoxelShapeDialog();
		},
	});

	var addVoxelShapesGroupAction = new Action({
		id: 'voxelshape_exporter.add_group',
		name: 'Add VoxelShapes Group',
		icon: 'create_new_folder',
		description: 'Add a group named VoxelShapes',
		category: 'edit',
		condition: () => Format.id === 'java_block' && Modes.edit,
		click: function() {
			Undo.initEdit({outliner: true, groups: []});
			new Group({
				name: 'VoxelShapes',
				isOpen: true,
			}).init();
			Undo.finishEdit('Add VoxelShapes Group');
		},
	});

	function showVoxelShapeDialog() {
		var stored = localStorage.getItem(storageKey);
		if (!Mappings[stored]) stored = 'mojmaps';

		var storedVersion = localStorage.getItem(versionStorageKey);
		if (storedVersion !== 'modern' && storedVersion !== 'legacy') storedVersion = 'legacy';

		var dialog = new Dialog({
			id: 'voxelshape_exporter.dialog',
			title: 'VoxelShape Exporter',
			width: 700,
			resizable: true,
			buttons: [],
			part_order: ['form', 'component'],
			form: {
				mappings: {
					label: 'Mappings',
					type: 'select',
					options: {
						mojmaps: "MojMaps (Mojang's Official Mappings)",
						mcp: 'MCP',
						yarn: 'Yarn',
						parchment: 'Parchment',
					},
					value: stored,
					description: 'Select the mappings being used by your development environment',
				},
				version: {
					label: 'Minecraft Version',
					type: 'select',
					options: {
						modern: 'Modern (1.21.5 and above)',
						legacy: 'Legacy (1.21.4 and below)',
					},
					value: storedVersion,
					description: 'Select the Minecraft version you are targeting. Versions 1.21.5 and above provide dedicated Block methods for centered shapes',
				},
			},
			component: {
				components: {VuePrismEditor},
				data() {
					return {
						text: '',
						skipped: 0,
					};
				},
				methods: {
					copyText() {
						navigator.clipboard.writeText(this.text);
						Blockbench.showQuickMessage('Copied!', 1000);
					},
				},
				template: `
					<div class="voxelshape-output">
						<vue-prism-editor id="code-view-output" v-model="text" language="java" :line-numbers="true" />
						<div v-if="skipped > 0" class="voxelshape-warning">
							<i class="material-icons icon">warning</i>
							Skipped {{ skipped }} rotated cube{{ skipped === 1 ? '' : 's' }}
						</div>
						<button class="voxelshape-copy" @click="copyText()">Copy</button>
					</div>
				`,
			},
			onBuild() {
				this.object.classList.add('voxelshape-dialog');
				this.content_vue.text = exportShape(Mappings[stored], storedVersion);
				this.content_vue.skipped = skippedRotatedCubes;
			},
			onFormChange(formResult) {
				localStorage.setItem(storageKey, formResult.mappings);
				localStorage.setItem(versionStorageKey, formResult.version);
				this.content_vue.text = exportShape(Mappings[formResult.mappings], formResult.version);
				this.content_vue.skipped = skippedRotatedCubes;
			},
		});
		dialog.show();
	}

	function isRotated(cube) {
		var rotation = cube.rotation;
		return rotation[0] !== 0 || rotation[1] !== 0 || rotation[2] !== 0;
	}

	function cubeBox(cube) {
		var from = cube.from;
		var to = cube.to;
		return [
			Math.min(from[0], to[0]),
			Math.min(from[1], to[1]),
			Math.min(from[2], to[2]),
			Math.max(from[0], to[0]),
			Math.max(from[1], to[1]),
			Math.max(from[2], to[2]),
		];
	}

	function uniqueSorted(values) {
		values.sort((a, b) => a - b);
		var result = [];
		for (var i = 0; i < values.length; i++) {
			if (i === 0 || values[i] !== values[i - 1]) result.push(values[i]);
		}
		return result;
	}

	function isBoxCovered(target, boxes) {
		for (var i = 0; i < boxes.length; i++) {
			var box = boxes[i];
			if (
				box[0] <= target[0] && box[1] <= target[1] && box[2] <= target[2] &&
				box[3] >= target[3] && box[4] >= target[4] && box[5] >= target[5]
			) {
				return true;
			}
		}

		var xs = [target[0], target[3]];
		var ys = [target[1], target[4]];
		var zs = [target[2], target[5]];
		var relevant = [];

		for (var j = 0; j < boxes.length; j++) {
			var b = boxes[j];
			if (
				b[0] > target[3] || b[3] < target[0] ||
				b[1] > target[4] || b[4] < target[1] ||
				b[2] > target[5] || b[5] < target[2]
			) {
				continue;
			}
			relevant.push(b);
			xs.push(Math.max(b[0], target[0]), Math.min(b[3], target[3]));
			ys.push(Math.max(b[1], target[1]), Math.min(b[4], target[4]));
			zs.push(Math.max(b[2], target[2]), Math.min(b[5], target[5]));
		}

		if (relevant.length === 0) return false;

		xs = uniqueSorted(xs);
		ys = uniqueSorted(ys);
		zs = uniqueSorted(zs);

		for (var xi = 0; xi < xs.length - 1; xi++) {
			for (var yi = 0; yi < ys.length - 1; yi++) {
				for (var zi = 0; zi < zs.length - 1; zi++) {
					var px = (xs[xi] + xs[xi + 1]) / 2;
					var py = (ys[yi] + ys[yi + 1]) / 2;
					var pz = (zs[zi] + zs[zi + 1]) / 2;
					var covered = false;
					for (var k = 0; k < relevant.length; k++) {
						var r = relevant[k];
						if (r[0] <= px && px <= r[3] && r[1] <= py && py <= r[4] && r[2] <= pz && pz <= r[5]) {
							covered = true;
							break;
						}
					}
					if (!covered) return false;
				}
			}
		}
		return true;
	}

	function cubeToString(cube, mappings, version) {
		var from = cube.from;
		var to = cube.to;
		var sizeX = to[0] - from[0];
		var sizeY = to[1] - from[1];
		var sizeZ = to[2] - from[2];

		if (version === 'modern' && mappings.cube) {
			var centerX = from[0] + to[0] === 16;
			var centerY = from[1] + to[1] === 16;
			var centerZ = from[2] + to[2] === 16;

			if (centerX && centerY && centerZ) {
				var cubeArgs = sizeX === sizeY && sizeY === sizeZ
					? '' + sizeX
					: sizeX + ', ' + sizeY + ', ' + sizeZ;
				return mappings.cube + '(' + cubeArgs + ')';
			}
			if (centerX && centerZ) {
				var columnArgs = sizeX === sizeZ
					? sizeX + ', ' + from[1] + ', ' + to[1]
					: sizeX + ', ' + sizeZ + ', ' + from[1] + ', ' + to[1];
				return mappings.column + '(' + columnArgs + ')';
			}
			if (centerX && centerY) {
				var boxZArgs = sizeX === sizeY
					? sizeX + ', ' + from[2] + ', ' + to[2]
					: sizeX + ', ' + sizeY + ', ' + from[2] + ', ' + to[2];
				return mappings.boxZ + '(' + boxZArgs + ')';
			}
			if (centerX) {
				return mappings.boxZ + '(' + sizeX + ', ' + from[1] + ', ' + to[1] + ', ' + from[2] + ', ' + to[2] + ')';
			}
		}

		return mappings.createCube +
			'(' +
			from[0] + ', ' +
			from[1] + ', ' +
			from[2] + ', ' +
			to[0] + ', ' +
			to[1] + ', ' +
			to[2] +
			')';
	}

	function exportShape(mappings, version) {
		skippedRotatedCubes = 0;
		addedBoxes = [];

		var groups = searchVoxelShapeGroups();
		if (groups.length === 0) {
			return generateShape(undefined, mappings, version, true);
		}

		var children = [];
		groups.forEach((group) => {
			group.children.forEach((child) => children.push(child));
		});

		return generateShape({name: 'VoxelShapes', children: children}, mappings, version, true);
	}

	function generateShape(group, mappings, version, parentIsUnion) {
		var elements = group === undefined ? Outliner.elements : group.children;

		var operation = 'OR';
		if (group !== undefined) {
			operation = group.name[0] === '$' ? group.name.substring(1).toUpperCase() : 'OR';
			if (operation === 'VOXELSHAPES') {
				operation = 'OR';
			}
		}

		var inUnion = parentIsUnion && operation === 'OR';
		var method = [];

		for (var i = 0; i < elements.length; i++) {
			var child = elements[i];
			if (child instanceof Group) {
				var nested = generateShape(child, mappings, version, inUnion);
				if (nested) method.push(nested);
			} else if (isRotated(child)) {
				skippedRotatedCubes++;
			} else {
				var box = cubeBox(child);
				if (inUnion && isBoxCovered(box, addedBoxes)) {
					continue;
				}
				method.push(cubeToString(child, mappings, version));
				if (inUnion) addedBoxes.push(box);
			}
		}

		if (method.length === 0) {
			return '';
		}

		if (operation === 'OR') {
			var output = mappings.union + '(\n';

			for (var j = 0; j < method.length; j++) {
				if (j == method.length - 1) {
					output = output + method[j] + '\n';
				} else {
					output = output + method[j] + ',\n';
				}
			}

			return output + ')';
		} else {
			var output = method[method.length - 1];
			for (var k = method.length - 2; k >= 0; k--) {
				output =
					mappings.combine +
					'(' +
					method[k] +
					', ' +
					output +
					', ' +
					mappings.booleanFunction +
					'.' +
					operation +
					')';
			}
			return output;
		}
	}

	function searchVoxelShapeGroups() {
		return Group.all.filter((group) => group.name === 'VoxelShapes');
	}

	BBPlugin.register('voxelshape_exporter', {
		title: 'VoxelShape Exporter',
		author: 'Snownee, JTK222, Ocraftyone',
		icon: 'fa-cubes',
		description: "Export your Java block model's cubes as a Minecraft VoxelShape (1.14+ modded)",
		tags: ['Minecraft: Java Edition', 'Exporter'],
		version: '1.1.0',
		min_version: '4.8.0',
		variant: 'both',
		new_repository_format: true,
		has_changelog: true,
		creation_date: '2026-10-13',
		onload() {
			styles = Blockbench.addCSS(dialogStyles);
			MenuBar.addAction(exportVoxelShapeAction, 'file.export');
			BarItems.add_element.side_menu.addAction(addVoxelShapesGroupAction);
		},
		onunload() {
			exportVoxelShapeAction.delete();
			addVoxelShapesGroupAction.delete();
			styles.delete();
		},
	});

})();

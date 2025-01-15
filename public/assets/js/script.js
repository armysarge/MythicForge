/**
 * @file script.js
 * @fileoverview The main script file for Mythic Forge application, handling monster data management,
 * window creation, and UI interactions.
 *
 * @requires jQuery
 * @requires jQuery UI
 * @requires Renderer
 * @requires Parser
 * @requires DataLoader
 * @requires UrlUtil
 *
 * @global {Array} AllMonsters - Array containing all monster data
 * @global {Array} AllSpells - Array containing all spell data
 * @global {Array} AllItems - Array containing all item data
 * @global {boolean} SRDonly - Flag to determine if only SRD content should be displayed
 *
 * @author Shaun Scholtz
 * @version 0.0.1
 * @license AGPLv3
 *
 * @example
 * // Create a new window
 * const window = new MythicForgeWindow();
 * window.createWindow('Title', 'Content');
 *
 * // Display monster stat block
 * createMonsterStatBlock('Goblin', 'MM');
 */
AllMonsters = [];
AllSpells = [];
AllItems = [];
SRDonly = false;

// Document ready function
$.when( $.ready ).then(function() {

    // Load all monster data from 5etools and correct the data
    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY,1).then(function(data){
        AllMonsters = data;
        correctMonsterDetails();
        //getMonsterByName("Goblin","Mm").then(function(monster){console.log(monster)});
        //createMonsterStatBlock("Goblin","mm");
    });

    // Open and close the bestiary window
    $(".showBestiary").on("click tap", function(evt) {
        if ($(".bestiaryWindow").length == 0) {
            var bestiaryWindow = new MythicForgeWindow();
            bestiaryWindow.createWindow("Bestiary", `
                <div class="bestiaryContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchBestiary" placeholder="Search here">
                <table class="bestiaryList">
                    <thead>
                        <tr>
                            <th>Monster</th>
                            <th>Type</th>
                            <th>CR</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                </table>
                </div>
            `);
            bestiaryWindow.el.addClass("bestiaryWindow");
            bestiaryWindow.el.fadeIn();

            $(".bestiaryWindow").on("click tap", ".bestiaryList .bestiaryItem", function(evt) {
                var monsterName = $(this).data("name");
                var monsterSource = $(this).data("source");
                createMonsterStatBlock(monsterName,monsterSource);
            });

            let searchTimeout;
            $(".bestiaryWindow").on("keyup", ".searchBestiary", function(evt) {
                const search = $(this).val().toLowerCase();
                if (search.length < 3) return;

                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const bestiaryList = $(".bestiaryWindow .bestiaryList");
                    bestiaryList.find("tbody").remove();
                    const tbody = $("<tbody></tbody>");

                    $.each(AllMonsters, function(monsterIndex, monster){
                        if (SRDonly)
                            if (typeof monster.srd != "undefined"){
                                //if srd is true, then the monster is from the srd
                                if (!monster.srd){
                                    //remove the monster from the list
                                    return;
                                }
                            }else{
                                //remove the monster from the list
                                return;
                            }
                        if (monster.name.toLowerCase().includes(search)){
                            var monsterAlignment = Renderer.monster.getTypeAlignmentPart(monster);
                            var monsterCR = (monster.cr)?monster.cr:"-";
                            var tr = `<tr class='bestiaryItem' data-name='${monster.name}' data-source='${monster.source}'>
                                <td>${monster.name}</td>
                                <td>${monsterAlignment}</td>
                                <td>${monsterCR}</td>
                                <td>${monster.source?monster.source:"-"}</td>
                            </tr>`;
                            tbody.append(tr);
                        }
                    });
                    bestiaryList.append(tbody);
                }, 500);
            });
        }else{
            if ($(".bestiaryWindow").css("display") == "block" && $(".bestiaryWindow").hasClass("focused")) {
                $(".bestiaryWindow").css("display", "none");
                return;
            }else{
                $(".bestiaryWindow").fadeIn();
            }
        }
    });
});

/**
 * Creates and displays a monster stat block window using MythicForge
 * @param {string} monster - The name of the monster to display
 * @param {string} source - The source book or reference where the monster data comes from
 * @returns {void} - Does not return a value
 * @async - Contains asynchronous operation via Promise
 */
function createMonsterStatBlock(monster,source){
    getMonsterByName(monster,source).then(function(theMonster){
        var monsterStatBlock = new MythicForgeWindow();
        monsterStatBlock.createWindow(theMonster.name, "");
        monsterStatBlock.monsterStatBlock(theMonster.name,theMonster.source);
    });
}

/**
 * Filters the AllMonsters array based on SRD (System Reference Document) status.
 * If SRDonly is true, this function removes any monsters that are either:
 * 1. Explicitly marked as non-SRD (monster.srd === false)
 * 2. Don't have an SRD property defined
 *
 * @global
 * @function correctMonsterDetails
 * @requires jQuery
 * @requires AllMonsters - Global array containing monster objects
 * @requires SRDonly - Global boolean indicating whether to filter for SRD-only content
 */
function correctMonsterDetails(){
    $.each(AllMonsters, function(monsterIndex, monster){
        if (monster){
            if (SRDonly)
                if (typeof monster.srd != "undefined"){
                    //if srd is true, then the monster is from the srd
                    if (!monster.srd){
                        //remove the monster from the list
                        AllMonsters.splice(monsterIndex, 1);
                    }
                }else{
                    //remove the monster from the list
                    AllMonsters.splice(monsterIndex, 1);
                }
        }
    });
}

/**
 * Retrieves a monster by its name and source, including its fluff data.
 * @param {string} name - The name of the monster to search for
 * @param {string} source - The source book/material the monster is from
 * @returns {Promise<Object>} A promise that resolves with the monster object including fluff data, or rejects with an error message
 * @throws {string} "Monster not found" if the monster cannot be found in AllMonsters
 */
function getMonsterByName(name, source) {
    return new Promise((resolve, reject) => {
        let theMonster = AllMonsters.find(monster => monster.name.toLowerCase() === name.toLowerCase() && monster.source.toLowerCase() === source.toLowerCase());

        if (!theMonster) {
            reject("Monster not found");
            return;
        }

        DataLoader.pCacheAndGetHash("monsterFluff", UrlUtil.URL_TO_HASH_BUILDER["monsterFluff"]({ name: name, source: source }))
            .then(fluff => {
                theMonster.fluff = fluff;
                resolve(theMonster);
            })
            .catch(err => reject(err));
    });
}

